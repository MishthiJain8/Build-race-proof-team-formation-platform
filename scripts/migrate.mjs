import {initDb,pool} from "../server.mjs";
try{
  await initDb();
  console.log("Schema ready");
}finally{
  await pool.end();
}
