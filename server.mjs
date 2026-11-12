import "dotenv/config";
import express from "express";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const SECRET = process.env.JWT_SECRET || "local-only-change-me";
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("Production requires JWT_SECRET of at least 32 characters");
}
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://teamforge:teamforge_dev@localhost:5432/teamforge",
  max: process.env.VERCEL ? 4 : 40
});
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "24kb" }));

const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
const fail = (status,message) => { const e=new Error(message);e.status=status;throw e; };
const parse = (schema,value) => schema.parse(value);
const uid = z.string().uuid();
const nameSchema = z.string().trim().min(2).max(70);
const authLimiter = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
const inviteLimiter = rateLimit({ windowMs: 60000, limit: 100, standardHeaders: "draft-7", legacyHeaders: false });
const passwordSchema = z.string().min(8).max(100);
const keyPattern = /^[a-zA-Z0-9_-]{8,128}$/;

export async function initDb(){
  await pool.query(readFileSync(new URL("./db/schema.sql",import.meta.url),"utf8"));
}
function tokenFor(id){
  return jwt.sign({ sub:id }, SECRET, { algorithm:"HS256", expiresIn:"7d" });
}
export function tokenForTest(id){ return tokenFor(id); }

function auth(req,res,next){
  try {
    const raw = req.get("authorization") || "";
    if (!raw.startsWith("Bearer ")) return res.status(401).json({ error:"Sign in first" });
    const payload = jwt.verify(raw.slice(7),SECRET,{algorithms:["HS256"]});
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error:"Invalid or expired session" });
  }
}

async function txAction(req,res,handler){
  const key = req.get("idempotency-key");
  if (!keyPattern.test(key||"")) fail(400,"Idempotency-Key required (8-128 safe characters)");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const inserted=await client.query(
      "INSERT INTO idempotency_keys(actor_id,route,key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING key",
      [req.userId,req.path,key]
    );
    if(!inserted.rowCount){
      const old=await client.query(
        "SELECT status,response FROM idempotency_keys WHERE actor_id=$1 AND route=$2 AND key=$3",
        [req.userId,req.path,key]
      );
      await client.query("COMMIT");
      return res.status(old.rows[0].status).json(old.rows[0].response);
    }
    const output=await handler(client);
    const status=output.status||200;
    await client.query(
      "UPDATE idempotency_keys SET status=$4,response=$5 WHERE actor_id=$1 AND route=$2 AND key=$3",
      [req.userId,req.path,key,status,JSON.stringify(output.body)]
    );
    await client.query("COMMIT");
    return res.status(status).json(output.body);
  }catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    throw err;
  }finally{
    client.release();
  }
}
async function logChange(c,team,actor,action,subject=null,details={}){
  await c.query(
    "INSERT INTO audit_log(team_id,actor_id,action,subject_id,details) VALUES($1,$2,$3,$4,$5)",
    [team,actor,action,subject,JSON.stringify(details)]
  );
  await c.query("SELECT pg_notify('teamforge_changes',$1)",[JSON.stringify({ type:"refresh", team })]);
}
async function lockedTeam(c,teamId){
  const r=await c.query("SELECT * FROM teams WHERE id=$1 FOR UPDATE",[teamId]);
  if(!r.rowCount) fail(404,"Team not found");
  return r.rows[0];
}
function leaderOnly(team,userId){
  if(team.leader_id!==userId) fail(403,"Only the team leader can do that");
}
async function mustNotBeMember(c,userId){
  const r=await c.query("SELECT 1 FROM memberships WHERE hackathon_id=$1 AND user_id=$2",[EVENT_ID,userId]);
  if(r.rowCount) fail(409,"You already belong to a team in this hackathon");
}
async function joinLocked(c,team,actor,action){
  await mustNotBeMember(c,actor);
  if(team.member_count>=team.max_size) fail(409,"Team is full");
  await c.query(
    "INSERT INTO memberships(hackathon_id,user_id,team_id) VALUES($1,$2,$3)",
    [EVENT_ID,actor,team.id]
  );
  await c.query("UPDATE teams SET member_count=member_count+1 WHERE id=$1",[team.id]);
  await logChange(c,team.id,actor,action,actor);
}

app.get("/api/health",wrap(async(req,res)=>{
  await pool.query("SELECT 1");
  res.json({ok:true, service:"TeamForge"});
}));

app.get("/api/hackathon",wrap(async(req,res)=>{
  const r=await pool.query("SELECT * FROM hackathons WHERE id=$1",[EVENT_ID]);
  res.json(r.rows[0]);
}));

app.post("/api/auth/register",authLimiter,wrap(async(req,res)=>{
  const body=parse(z.object({
    name:nameSchema,
    email:z.string().email().max(180),
    password:passwordSchema,
    skills:z.array(z.string().trim().min(1).max(30)).max(12).default([]),
    timezone:z.string().trim().min(3).max(32).default("UTC+05:30")
  }),req.body);
  const email=body.email.toLowerCase().trim();
  const hash=await bcrypt.hash(body.password,11);
  const r=await pool.query(
    "INSERT INTO users(name,email,password_hash,skills,timezone) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,skills,timezone",
    [body.name,email,hash,body.skills,body.timezone]
  );
  res.status(201).json({user:r.rows[0],token:tokenFor(r.rows[0].id)});
}));

app.post("/api/auth/login",authLimiter,wrap(async(req,res)=>{
  const b=parse(z.object({email:z.string().email(),password:z.string()}),req.body);
  const r=await pool.query("SELECT * FROM users WHERE email=$1",[b.email.toLowerCase().trim()]);
  if(!r.rowCount || !await bcrypt.compare(b.password,r.rows[0].password_hash)) fail(401,"Invalid credentials");
  const { password_hash,...user }=r.rows[0];
  res.json({user,token:tokenFor(user.id)});
}));

app.get("/api/board",wrap(async(req,res)=>{
  const page=Math.max(0,Math.min(1000,Number.parseInt(req.query.page,10)||0));
  const search=String(req.query.search||"").slice(0,70);
  const result=await pool.query(
    `SELECT t.id,t.name,t.member_count,t.max_size,t.created_at,
      u.name AS leader_name,
      (t.member_count>=h.min_size) AS ready
     FROM teams t
     JOIN users u ON u.id=t.leader_id
     JOIN hackathons h ON h.id=t.hackathon_id
     WHERE t.hackathon_id=$1 AND t.name ILIKE $2
     ORDER BY t.created_at DESC,t.id DESC LIMIT 30 OFFSET $3`,
    [EVENT_ID,"%"+search+"%",page*30]
  );
  res.json({ teams:result.rows,page });
}));

app.get("/api/events", (req,res)=>{
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache,no-transform");
  res.setHeader("Connection","keep-alive");
  res.flushHeaders?.();
  res.write('data: {"type":"connected"}\n\n');
  clients.add(res);
  const heartbeat=setInterval(()=>res.write(": ping\n\n"),25000);
  req.on("close",()=>{
    clearInterval(heartbeat);
    clients.delete(res);
  });
});
const clients=new Set();
export async function startListener(){
  const client=await pool.connect();
  client.on("notification",()=>{
    for(const res of clients){
      try{res.write('data: {"type":"refresh"}\n\n');}catch{clients.delete(res);}
    }
  });
  await client.query("LISTEN teamforge_changes");
  return client;
}

app.get("/api/me/team",auth,wrap(async(req,res)=>{
  const r=await pool.query(
    `SELECT t.* FROM teams t JOIN memberships m ON m.team_id=t.id
     WHERE m.hackathon_id=$1 AND m.user_id=$2`,
    [EVENT_ID,req.userId]
  );
  if(!r.rowCount) return res.json({team:null});
  const team=r.rows[0];
  const [members,requests,audit]=await Promise.all([
    pool.query(
      `SELECT u.id,u.name,u.skills,u.timezone,m.joined_at
       FROM memberships m JOIN users u ON u.id=m.user_id
       WHERE m.team_id=$1 ORDER BY m.joined_at,u.id`,[team.id]),
    team.leader_id===req.userId
      ?pool.query(
        `SELECT r.id,r.status,u.name,u.skills,u.timezone,r.created_at
         FROM join_requests r JOIN users u ON u.id=r.user_id
         WHERE r.team_id=$1 AND r.status='pending' ORDER BY r.created_at`,[team.id])
      :Promise.resolve({rows:[]}),
    pool.query("SELECT action,at,actor_id,subject_id,details FROM audit_log WHERE team_id=$1 ORDER BY id DESC LIMIT 30",[team.id])
  ]);
  res.json({team,members:members.rows,requests:requests.rows,audit:audit.rows});
}));

app.post("/api/teams",auth,wrap(async(req,res)=>txAction(req,res,async c=>{
  const b=parse(z.object({name:nameSchema,maxSize:z.number().int().min(2).max(5)}),req.body);
  await mustNotBeMember(c,req.userId);
  const created=await c.query(
    "INSERT INTO teams(hackathon_id,name,leader_id,max_size) VALUES($1,$2,$3,$4) RETURNING *",
    [EVENT_ID,b.name,req.userId,b.maxSize]
  );
  const team=created.rows[0];
  await c.query("INSERT INTO memberships(hackathon_id,user_id,team_id) VALUES($1,$2,$3)",[EVENT_ID,req.userId,team.id]);
  await logChange(c,team.id,req.userId,"team.created",req.userId,{name:team.name});
  return {status:201,body:{team}};
})));

app.post("/api/teams/:id/invites",auth,wrap(async(req,res)=>txAction(req,res,async c=>{
  const id=parse(uid,req.params.id);
  const team=await lockedTeam(c,id);
  leaderOnly(team,req.userId);
  const code=randomBytes(24).toString("base64url");
  const hash=createHash("sha256").update(code).digest("hex");
  await c.query(
    "INSERT INTO invites(code_hash,team_id,expires_at,max_uses) VALUES($1,$2,now()+interval '1 hour',100)",
    [hash,id]
  );
  await logChange(c,id,req.userId,"invite.created",null,{durationMinutes:60});
  return {status:201,body:{code,expiresInMinutes:60}};
})));

app.post("/api/invites/join",inviteLimiter,auth,wrap(async(req,res)=>txAction(req,res,async c=>{
  const b=parse(z.object({code:z.string().min(20).max(100)}),req.body);
  const hash=createHash("sha256").update(b.code).digest("hex");
  const found=await c.query("SELECT team_id FROM invites WHERE code_hash=$1",[hash]);
  if(!found.rowCount) fail(404,"Invalid invite code");
  const team=await lockedTeam(c,found.rows[0].team_id);
  const invite=await c.query("SELECT * FROM invites WHERE code_hash=$1 FOR UPDATE",[hash]);
  if(!invite.rowCount) fail(404,"Invalid invite code");
  if(new Date(invite.rows[0].expires_at)<=new Date() || invite.rows[0].uses>=invite.rows[0].max_uses)
    fail(410,"Invite expired or exhausted");
  await joinLocked(c,team,req.userId,"member.joined.invite");
  await c.query("UPDATE invites SET uses=uses+1 WHERE code_hash=$1",[hash]);
  return {body:{joined:true,teamId:team.id}};
})));

app.post("/api/teams/:id/requests",auth,wrap(async(req,res)=>txAction(req,res,async c=>{
  const id=parse(uid,req.params.id);
  const team=await lockedTeam(c,id);
  await mustNotBeMember(c,req.userId);
  if(team.member_count>=team.max_size) fail(409,"Team is full");
  const r=await c.query(
    `INSERT INTO join_requests(team_id,user_id) VALUES($1,$2)
     ON CONFLICT(team_id,user_id)
     DO UPDATE SET status='pending',created_at=now()
     RETURNING id,status`,[id,req.userId]
  );
  await logChange(c,id,req.userId,"request.created",req.userId);
  return {status:201,body:{request:r.rows[0]}};
})));

app.post("/api/teams/:id/requests/:requestId/decision",auth,wrap(async(req,res)=>txAction(req,res,async c=>{
  const id=parse(uid,req.params.id);
  const requestId=parse(uid,req.params.requestId);
  const b=parse(z.object({decision:z.enum(["accept","decline"])}),req.body);
  const team=await lockedTeam(c,id);
  leaderOnly(team,req.userId);
  const found=await c.query(
    "SELECT * FROM join_requests WHERE id=$1 AND team_id=$2 FOR UPDATE",[requestId,id]
  );
  if(!found.rowCount || found.rows[0].status!=="pending") fail(409,"Request is not pending");
  const candidate=found.rows[0].user_id;
  if(b.decision==="accept") await joinLocked(c,team,candidate,"member.joined.request");
  await c.query("UPDATE join_requests SET status=$2 WHERE id=$1",[requestId,b.decision==="accept"?"accepted":"declined"]);
  await logChange(c,id,req.userId,"request."+b.decision,candidate);
  return {body:{decision:b.decision}};
})));

app.post("/api/teams/:id/leave",auth,wrap(async(req,res)=>txAction(req,res,async c=>{
  const id=parse(uid,req.params.id);
  const team=await lockedTeam(c,id);
  const membership=await c.query(
    "SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2",[id,req.userId]
  );
  if(!membership.rowCount) fail(403,"You are not on this team");
  if(team.member_count===1){
    await logChange(c,id,req.userId,"team.deleted",req.userId,{reason:"last-member-left"});
    await c.query("DELETE FROM teams WHERE id=$1",[id]);
    return {body:{deleted:true}};
  }
  await c.query("DELETE FROM memberships WHERE team_id=$1 AND user_id=$2",[id,req.userId]);
  await c.query("UPDATE teams SET member_count=member_count-1 WHERE id=$1",[id]);
  await logChange(c,id,req.userId,"member.left",req.userId);
  if(team.leader_id===req.userId){
    const next=await c.query(
      "SELECT user_id FROM memberships WHERE team_id=$1 ORDER BY joined_at,user_id LIMIT 1",[id]
    );
    await c.query("UPDATE teams SET leader_id=$2 WHERE id=$1",[id,next.rows[0].user_id]);
    await logChange(c,id,req.userId,"leader.transferred",next.rows[0].user_id);
  }
  return {body:{left:true}};
})));

app.post("/api/teams/:id/remove",auth,wrap(async(req,res)=>txAction(req,res,async c=>{
  const id=parse(uid,req.params.id);
  const b=parse(z.object({userId:uid}),req.body);
  const team=await lockedTeam(c,id);
  leaderOnly(team,req.userId);
  if(b.userId===req.userId) fail(400,"Use Leave Team to leave");
  const removed=await c.query(
    "DELETE FROM memberships WHERE team_id=$1 AND user_id=$2 RETURNING user_id",[id,b.userId]
  );
  if(!removed.rowCount) fail(404,"Member not found");
  await c.query("UPDATE teams SET member_count=member_count-1 WHERE id=$1",[id]);
  await logChange(c,id,req.userId,"member.removed",b.userId);
  return {body:{removed:true}};
})));

app.get("/api/suggestions",auth,wrap(async(req,res)=>{
  const teamId=parse(uid,req.query.teamId);
  const mine=await pool.query(
    `SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2`,[teamId,req.userId]
  );
  if(!mine.rowCount) fail(403,"You must be a team member");
  const teamSkills=await pool.query(
    `SELECT u.skills,u.timezone FROM memberships m
     JOIN users u ON u.id=m.user_id WHERE m.team_id=$1`,[teamId]
  );
  const candidates=await pool.query(
    `SELECT u.id,u.name,u.skills,u.timezone FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM memberships m
       WHERE m.hackathon_id=$1 AND m.user_id=u.id)
     ORDER BY u.created_at DESC LIMIT 300`,[EVENT_ID]
  );
  const have=new Set(teamSkills.rows.flatMap(x=>x.skills.map(s=>s.toLowerCase())));
  const parseTz=(v)=>{
    const m=/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(v);
    return m?(m[1]==="-"?-1:1)*(Number(m[2])+Number(m[3]||0)/60):0;
  };
  const tz=teamSkills.rows.length
    ?teamSkills.rows.reduce((sum,x)=>sum+parseTz(x.timezone),0)/teamSkills.rows.length:0;
  const ranked=candidates.rows.map(u=>{
    const newSkills=u.skills.filter(s=>!have.has(s.toLowerCase()));
    const overlap=u.skills.filter(s=>have.has(s.toLowerCase()));
    const hours=Math.abs(parseTz(u.timezone)-tz);
    const timezonePoints=Math.max(0,4-Math.round(hours));
    const score=5*newSkills.length+2*overlap.length+timezonePoints;
    return {...u,score,reason:`${newSkills.length} complementary skills, ${overlap.length} shared skills, ${timezonePoints} time-zone points`};
  }).sort((a,b)=>b.score-a.score).slice(0,15);
  res.json({formula:"5×new skills + 2×shared skills + max(0,4−rounded timezone hour difference)",candidates:ranked});
}));

app.get("/api/teams/:id/audit",auth,wrap(async(req,res)=>{
  const id=parse(uid,req.params.id);
  const m=await pool.query("SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2",[id,req.userId]);
  if(!m.rowCount) fail(403,"Team membership required");
  const r=await pool.query(
    "SELECT action,actor_id,subject_id,details,at FROM audit_log WHERE team_id=$1 ORDER BY id DESC LIMIT 100",[id]
  );
  res.json({events:r.rows});
}));

const root=dirname(fileURLToPath(import.meta.url));
const dist=join(root,"dist");
if(existsSync(dist) && !process.env.VERCEL){
  app.use(express.static(dist));
  app.get("*",(req,res,next)=>{
    if(req.path.startsWith("/api/")) return next();
    res.sendFile(join(dist,"index.html"));
  });
}


// TEAMFORGE_HOME_ROUTE
app.get("/", (req, res) => {
  return res.redirect(302, "/index.html");
});

app.use((err,req,res,next)=>{
  const status=err.status || (err instanceof z.ZodError?400:err.code==="23505"?409:500);
  if(status>=500) console.error("API error",err);
  res.status(status).json({
    error:err instanceof z.ZodError?"Invalid input: "+err.issues.map(x=>x.path.join(".")).join(", ")
      :err.code==="23505"?"Conflict: unique membership or email already exists"
      :status>=500?"Internal server error":err.message
  });
});

export default app;
