import "dotenv/config";
import {pool,initDb,EVENT_ID} from "../server.mjs";
import bcrypt from "bcryptjs";

await initDb();
const already=await pool.query("SELECT count(*)::int AS count FROM users WHERE email LIKE 'seed-%@example.invalid'");
if(already.rows[0].count>0){
  console.log("Seed accounts already exist; skipping.");
  await pool.end();
  process.exit(0);
}
const hash=await bcrypt.hash("DemoPass123!",10);
console.log("Seeding 10,000 users...");
for(let start=0;start<10000;start+=500){
  const values=[];
  const params=[];
  for(let i=start;i<start+500;i++){
    params.push("Seed Student "+i,"seed-"+i+"@example.invalid",hash,
      i%2===0?["React","JavaScript"]:["Python","PostgreSQL"],
      i%3===0?"UTC+05:30":"UTC+00:00");
    const n=values.length*5;
    values.push("($"+(n+1)+",$"+(n+2)+",$"+(n+3)+",$"+(n+4)+",$"+(n+5)+")");
  }
  await pool.query(
    "INSERT INTO users(name,email,password_hash,skills,timezone) VALUES "+values.join(","),
    params
  );
}
const people=await pool.query(
  "SELECT id FROM users WHERE email LIKE 'seed-%@example.invalid' ORDER BY email LIMIT 10000"
);
console.log("Seeding 2,000 teams...");
for(let i=0;i<2000;i++){
  const ids=people.rows.slice(i*4,i*4+4).map(x=>x.id);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const r=await client.query(
      "INSERT INTO teams(hackathon_id,name,leader_id,max_size,member_count) VALUES($1,$2,$3,5,4) RETURNING id",
      [EVENT_ID,"Seed Team "+(i+1),ids[0]]
    );
    const teamId=r.rows[0].id;
    for(const id of ids){
      await client.query(
        "INSERT INTO memberships(hackathon_id,user_id,team_id) VALUES($1,$2,$3)",
        [EVENT_ID,id,teamId]
      );
    }
    await client.query("COMMIT");
  }catch(err){
    await client.query("ROLLBACK");
    throw err;
  }finally{
    client.release();
  }
  if((i+1)%250===0) console.log(i+1,"teams ready");
}
console.log("Done: 10,000 users and 2,000 teams.");
console.log("Local demo login: seed-8000@example.invalid / DemoPass123!");
console.log("Never use seeded passwords for a public production instance.");
await pool.end();
