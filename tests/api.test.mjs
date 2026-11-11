import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {app,pool,initDb,EVENT_ID,tokenForTest} from "../server.mjs";

let server,base;
let leader,member,requester,outsider,team,invite,requestId;
const suffix=randomUUID().slice(0,8);

before(async()=>{
  await initDb();
  server=app.listen(0);
  await new Promise(resolve=>server.once("listening",resolve));
  base="http://127.0.0.1:"+server.address().port;
});
after(async()=>{
  if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
});

async function api(path,{method="GET",body,token,key}={}){
  const response=await fetch(base+"/api"+path,{
    method,
    headers:{
      "Content-Type":"application/json",
      ...(token?{Authorization:"Bearer "+token}:{}),
      ...(method!=="GET"?{"Idempotency-Key":key||randomUUID()}: {})
    },
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:response.status,body:await response.json()};
}
async function signup(name){
  const r=await api("/auth/register",{
    method:"POST",
    body:{name,email:name.toLowerCase().replace(/\s/g,"")+"-"+suffix+"-"+randomUUID().slice(0,6)+"@test.invalid",password:"StrongPass123!",skills:["React","SQL"],timezone:"UTC+05:30"}
  });
  assert.equal(r.status,201);
  return r.body;
}
const p=(path,token,body={},key)=>api(path,{method:"POST",token,body,key});

test("01 health check",async()=>{
  assert.equal((await api("/health")).status,200);
});
test("02 hackathon has minimum two and maximum five",async()=>{
  const r=await api("/hackathon");
  assert.equal(r.body.min_size,2);
  assert.equal(r.body.max_size,5);
});
test("03 board is publicly readable",async()=>{
  assert.equal((await api("/board")).status,200);
});
test("04 team creation requires authentication",async()=>{
  assert.equal((await p("/teams",null,{name:"Test Squad",maxSize:5})).status,401);
});
test("05 signup validates input",async()=>{
  const r=await api("/auth/register",{method:"POST",body:{name:"a",email:"bad",password:"123"}});
  assert.equal(r.status,400);
});
test("06 create account",async()=>{
  leader=await signup("Leader");
  assert.ok(leader.token);
});
test("07 duplicate email conflicts",async()=>{
  const r=await api("/auth/register",{method:"POST",body:{name:"Another Name",email:leader.user.email,password:"StrongPass123!"}});
  assert.equal(r.status,409);
});
test("08 bad password rejected",async()=>{
  const r=await api("/auth/login",{method:"POST",body:{email:leader.user.email,password:"incorrect"}});
  assert.equal(r.status,401);
});
test("09 correct password accepted",async()=>{
  const r=await api("/auth/login",{method:"POST",body:{email:leader.user.email,password:"StrongPass123!"}});
  assert.equal(r.status,200);
});
test("10 maximum team size validated",async()=>{
  const r=await p("/teams",leader.token,{name:"Invalid Team",maxSize:99});
  assert.equal(r.status,400);
});
test("11 create a team",async()=>{
  const r=await p("/teams",leader.token,{name:"Race Proof "+suffix,maxSize:3});
  assert.equal(r.status,201);
  team=r.body.team;
});
test("12 one team per user per hackathon",async()=>{
  const r=await p("/teams",leader.token,{name:"Another Team",maxSize:5});
  assert.equal(r.status,409);
});
test("13 idempotency replay does not duplicate team",async()=>{
  const second=await signup("Second Leader");
  const key=randomUUID();
  const a=await p("/teams",second.token,{name:"Replay Team",maxSize:2},key);
  const b=await p("/teams",second.token,{name:"Replay Team",maxSize:2},key);
  assert.equal(a.status,201);
  assert.equal(b.body.team.id,a.body.team.id);
});
test("14 nonleader cannot create invite",async()=>{
  outsider=await signup("Outsider");
  assert.equal((await p("/teams/"+team.id+"/invites",outsider.token)).status,403);
});
test("15 leader creates cryptographically random invite",async()=>{
  const r=await p("/teams/"+team.id+"/invites",leader.token);
  assert.equal(r.status,201);
  invite=r.body.code;
  assert.ok(invite.length>=24);
});
test("16 malformed invite code rejected",async()=>{
  assert.equal((await p("/invites/join",outsider.token,{code:"bad"})).status,400);
});
test("17 unknown invite code rejected",async()=>{
  assert.equal((await p("/invites/join",outsider.token,{code:"x".repeat(32)})).status,404);
});
test("18 join with invite succeeds",async()=>{
  member=await signup("Member");
  assert.equal((await p("/invites/join",member.token,{code:invite})).status,200);
});
test("19 duplicate membership rejected",async()=>{
  assert.equal((await p("/invites/join",member.token,{code:invite})).status,409);
});
test("20 team page shows member count",async()=>{
  const r=await api("/me/team",{token:leader.token});
  assert.equal(r.body.team.member_count,2);
});
test("21 outsider can request to join",async()=>{
  requester=await signup("Requester");
  const r=await p("/teams/"+team.id+"/requests",requester.token);
  assert.equal(r.status,201);
  requestId=r.body.request.id;
});
test("22 nonleader cannot accept request",async()=>{
  const r=await p("/teams/"+team.id+"/requests/"+requestId+"/decision",member.token,{decision:"accept"});
  assert.equal(r.status,403);
});
test("23 leader accepts request",async()=>{
  const r=await p("/teams/"+team.id+"/requests/"+requestId+"/decision",leader.token,{decision:"accept"});
  assert.equal(r.status,200);
});
test("24 team full rejects joining",async()=>{
  const r=await p("/invites/join",outsider.token,{code:invite});
  assert.equal(r.status,409);
});
test("25 audit log records transitions",async()=>{
  const r=await api("/teams/"+team.id+"/audit",{token:leader.token});
  assert.equal(r.status,200);
  assert.ok(r.body.events.some(e=>e.action==="member.joined.request"));
});
test("26 audit access restricted to members",async()=>{
  assert.equal((await api("/teams/"+team.id+"/audit",{token:outsider.token})).status,403);
});
test("27 teammate suggestions score is exposed",async()=>{
  const r=await api("/suggestions?teamId="+team.id,{token:leader.token});
  assert.equal(r.status,200);
  assert.ok(r.body.formula.includes("skills"));
});
test("28 leader leaving transfers leadership",async()=>{
  assert.equal((await p("/teams/"+team.id+"/leave",leader.token)).status,200);
  const r=await api("/me/team",{token:member.token});
  assert.equal(r.body.team.leader_id,member.user.id);
});
test("29 new leader can remove a teammate",async()=>{
  const r=await p("/teams/"+team.id+"/remove",member.token,{userId:requester.user.id});
  assert.equal(r.status,200);
});
test("30 last member leaving deletes team",async()=>{
  assert.equal((await p("/teams/"+team.id+"/leave",member.token)).status,200);
  const r=await api("/me/team",{token:member.token});
  assert.equal(r.body.team,null);
});
test("31 expired invite cannot be used",async()=>{
  const owner=await signup("Expiry Owner");
  const tr=await p("/teams",owner.token,{name:"Expiry "+suffix,maxSize:2});
  const ir=await p("/teams/"+tr.body.team.id+"/invites",owner.token);
  const {createHash}=await import("node:crypto");
  const hash=createHash("sha256").update(ir.body.code).digest("hex");
  await pool.query("UPDATE invites SET expires_at=now()-interval '1 minute' WHERE code_hash=$1",[hash]);
  const r=await p("/invites/join",outsider.token,{code:ir.body.code});
  assert.equal(r.status,410);
});
test("32 fifty concurrent joins yield exactly one final-seat winner",async()=>{
  const owner=await signup("Race Owner");
  const tr=await p("/teams",owner.token,{name:"Race Team "+suffix,maxSize:2});
  const ir=await p("/teams/"+tr.body.team.id+"/invites",owner.token);
  const ids=[];
  for(let i=0;i<50;i++){
    const inserted=await pool.query(
      "INSERT INTO users(name,email,password_hash,skills,timezone) VALUES($1,$2,$3,$4,$5) RETURNING id",
      ["Racer "+i,"racer-"+suffix+"-"+i+"-"+randomUUID().slice(0,5)+"@test.invalid","test-not-used",["Node"],"UTC+00:00"]
    );
    ids.push(inserted.rows[0].id);
  }
  const results=await Promise.all(ids.map(id=>p(
    "/invites/join",tokenForTest(id),{code:ir.body.code},randomUUID()
  )));
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.equal(results.filter(r=>r.status===409).length,49);
  const db=await pool.query("SELECT member_count FROM teams WHERE id=$1",[tr.body.team.id]);
  const rows=await pool.query("SELECT count(*)::int AS n FROM memberships WHERE team_id=$1",[tr.body.team.id]);
  assert.equal(db.rows[0].member_count,2);
  assert.equal(rows.rows[0].n,2);
});
