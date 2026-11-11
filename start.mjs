import {app,initDb,startListener} from "./server.mjs";

await initDb();
try{
  await startListener();
}catch(err){
  console.warn("PostgreSQL notifications unavailable; clients can still refresh manually.",err.message);
}
const port=Number(process.env.PORT||4000);
app.listen(port,"0.0.0.0",()=>{
  console.log("TeamForge running on http://localhost:"+port);
});
