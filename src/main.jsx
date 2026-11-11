import React,{useState,useEffect,useCallback} from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";

function App(){
  const [session,setSession]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("teamforge-session")||"null");}catch{return null;}
  });
  const [mode,setMode]=useState("login");
  const [account,setAccount]=useState({name:"",email:"",password:"",skills:"React, Node.js",timezone:"UTC+05:30"});
  const [board,setBoard]=useState([]);
  const [myTeam,setMyTeam]=useState(null);
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(0);
  const [teamName,setTeamName]=useState("");
  const [maxSize,setMaxSize]=useState(5);
  const [joinCode,setJoinCode]=useState("");
  const [generatedCode,setGeneratedCode]=useState("");
  const [suggestions,setSuggestions]=useState([]);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  const request=useCallback(async(path,options={})=>{
    const method=options.method||"GET";
    const headers={"Content-Type":"application/json"};
    if(session?.token) headers.Authorization="Bearer "+session.token;
    if(method!=="GET") headers["Idempotency-Key"]=options.key||crypto.randomUUID();
    const r=await fetch("/api"+path,{
      method,headers,
      body:options.body===undefined?undefined:JSON.stringify(options.body)
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error||"Request failed");
    return data;
  },[session]);

  const refresh=useCallback(async()=>{
    try{
      const [b,t]=await Promise.all([
        request("/board?search="+encodeURIComponent(search)+"&page="+page),
        session?request("/me/team"):Promise.resolve({team:null})
      ]);
      setBoard(b.teams);
      setMyTeam(t.team?t:null);
    }catch(err){setMessage(err.message);}
  },[request,search,page,session]);

  useEffect(()=>{
    refresh();
    const events=new EventSource("/api/events");
    events.onmessage=()=>refresh();
    const timer=setInterval(refresh,12000);
    return()=>{events.close();clearInterval(timer);};
  },[refresh]);

  async function run(action){
    setBusy(true);
    setMessage("");
    try{
      const value=await action();
      setMessage("Success");
      await refresh();
      return value;
    }catch(err){
      setMessage(err.message);
    }finally{setBusy(false);}
  }
  async function authenticate(e){
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try{
      const route=mode==="register"?"/auth/register":"/auth/login";
      const payload=mode==="register"
        ?{...account,skills:account.skills.split(",").map(x=>x.trim()).filter(Boolean)}
        :{email:account.email,password:account.password};
      const r=await fetch("/api"+route,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
      });
      const data=await r.json();
      if(!r.ok) throw new Error(data.error||"Authentication failed");
      setSession(data);
      localStorage.setItem("teamforge-session",JSON.stringify(data));
      setMessage("Signed in successfully");
    }catch(err){setMessage(err.message);}
    finally{setBusy(false);}
  }
  function logout(){
    localStorage.removeItem("teamforge-session");
    setSession(null);setMyTeam(null);setSuggestions([]);
  }
  const post=(path,body={})=>request(path,{method:"POST",body});
  const current=myTeam?.team;
  const amLeader=current&&current.leader_id===session?.user?.id;

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="logo">TF</span><span><strong>TeamForge</strong><small>Race-proof hackathon teams</small></span></div>
      <div className="right">
        <span className="live"><i/> LIVE BOARD</span>
        {session&&<><span className="username">{session.user.name}</span><button className="ghost" onClick={logout}>Sign out</button></>}
      </div>
    </header>
    <main>
      <section className="hero">
        <div className="eyebrow">HACK4HACK 2026 / PROBLEM STATEMENT 01</div>
        <h1>Find your team.<br/><em>Without the race conditions.</em></h1>
        <p>Invite teammates, join a squad, and collaborate in real time. When fifty users compete for the final seat, our database guarantees only one succeeds.</p>
        <div className="stats">
          <span><strong>{board.length}</strong><small>Teams on this page</small></span>
          <span><strong>5</strong><small>Maximum team size</small></span>
          <span><strong>LIVE</strong><small>PostgreSQL notifications</small></span>
        </div>
      </section>

      {message&&<div className="notice" role="status">{message}<button onClick={()=>setMessage("")} aria-label="Dismiss">×</button></div>}

      {!session?
        <section className="authpanel">
          <div>
            <div className="eyebrow">GET STARTED</div>
            <h2>{mode==="register"?"Create your account":"Welcome back"}</h2>
            <p>Sign in to create teams, join by secure invite, or send a request to a team leader.</p>
          </div>
          <form onSubmit={authenticate} className="form">
            {mode==="register"&&<label>Full name<input required value={account.name} onChange={e=>setAccount({...account,name:e.target.value})}/></label>}
            <label>Email<input required type="email" value={account.email} onChange={e=>setAccount({...account,email:e.target.value})}/></label>
            <label>Password<input required type="password" minLength={8} value={account.password} onChange={e=>setAccount({...account,password:e.target.value})}/></label>
            {mode==="register"&&<>
              <label>Skills (comma-separated)<input value={account.skills} onChange={e=>setAccount({...account,skills:e.target.value})}/></label>
              <label>Timezone<input value={account.timezone} onChange={e=>setAccount({...account,timezone:e.target.value})}/></label>
            </>}
            <button className="primary" disabled={busy}>{mode==="register"?"Create account":"Sign in"}</button>
            <button className="linkbtn" type="button" onClick={()=>setMode(mode==="register"?"login":"register")}>{mode==="register"?"Already registered? Sign in":"New here? Create an account"}</button>
          </form>
        </section>:
        <div className="workspace">
          <div className="side">
            <section className="panel">
              <div className="panelhead"><h2>My squad</h2><span className="muted">01 / TEAM</span></div>
              {current?
                <>
                  <h3>{current.name}</h3>
                  <p className="muted">{current.member_count} / {current.max_size} members · {current.member_count>=2?"Ready":"Forming"}</p>
                  <div className="memberlist">
                    {myTeam.members.map(m=><div className="member" key={m.id}>
                      <div><strong>{m.name}</strong><small>{m.timezone} {m.id===current.leader_id?"· Leader":""}</small></div>
                      {amLeader&&m.id!==session.user.id&&<button className="danger tiny" disabled={busy} onClick={()=>run(()=>post("/teams/"+current.id+"/remove",{userId:m.id}))}>Remove</button>}
                    </div>)}
                  </div>
                  <button className="ghost" disabled={busy} onClick={()=>run(()=>post("/teams/"+current.id+"/leave"))}>Leave team</button>
                  {amLeader&&<>
                    <hr/>
                    <button className="primary" disabled={busy} onClick={async()=>{
                      const r=await run(()=>post("/teams/"+current.id+"/invites"));
                      if(r?.code) setGeneratedCode(r.code);
                    }}>Generate 1-hour invite</button>
                    {generatedCode&&<div className="codebox"><code>{generatedCode}</code><button onClick={()=>navigator.clipboard.writeText(generatedCode)}>Copy</button></div>}
                    <h4>Join requests</h4>
                    {myTeam.requests.length===0&&<p className="muted">No pending requests.</p>}
                    {myTeam.requests.map(r=><div className="request" key={r.id}>
                      <div><strong>{r.name}</strong><small>{r.skills.join(", ")}</small></div>
                      <div className="actions">
                        <button className="tiny" disabled={busy} onClick={()=>run(()=>post("/teams/"+current.id+"/requests/"+r.id+"/decision",{decision:"accept"}))}>Accept</button>
                        <button className="ghost tiny" disabled={busy} onClick={()=>run(()=>post("/teams/"+current.id+"/requests/"+r.id+"/decision",{decision:"decline"}))}>Decline</button>
                      </div>
                    </div>)}
                    </>}
                  <hr/>
                  <button className="ghost" disabled={busy} onClick={async()=>{
                    const r=await run(()=>request("/suggestions?teamId="+current.id));
                    if(r?.candidates) setSuggestions(r.candidates);
                  }}>Find complementary teammates</button>
                  {suggestions.length>0&&<div className="suggestions">{suggestions.slice(0,5).map(u=><div key={u.id}><strong>{u.name} · {u.score} pts</strong><small>{u.reason}</small></div>)}</div>}
                  <h4>Team audit log</h4>
                  <div className="audit">{myTeam.audit.map((a,i)=><div key={i}><b>{a.action}</b><small>{new Date(a.at).toLocaleString()}</small></div>)}</div>
                </>:
                <>
                  <p className="muted">You're not in a team yet. Start one or join an existing squad.</p>
                  <label>Team name<input placeholder="e.g. Binary Builders" value={teamName} onChange={e=>setTeamName(e.target.value)}/></label>
                  <label>Maximum members<select value={maxSize} onChange={e=>setMaxSize(Number(e.target.value))}>{[2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label>
                  <button className="primary" disabled={busy} onClick={()=>run(()=>post("/teams",{name:teamName,maxSize}))}>Create team</button>
                  <hr/>
                  <label>Have an invite code?<input placeholder="Paste secure invite code" value={joinCode} onChange={e=>setJoinCode(e.target.value)}/></label>
                  <button className="ghost" disabled={busy} onClick={()=>run(()=>post("/invites/join",{code:joinCode}))}>Join by code</button>
                </>}
            </section>
          </div>
          <div className="boardarea">
            <section className="panel boardpanel">
              <div className="panelhead"><div><div className="eyebrow">DISCOVER</div><h2>Looking for teammates</h2></div><button className="ghost" onClick={refresh}>Refresh ↻</button></div>
              <div className="searchrow"><input placeholder="Search team names..." aria-label="Search teams" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></div>
              <div className="cards">
                {board.map(t=><article className="teamcard" key={t.id}>
                  <div className="cardtop"><span className="pill">{t.ready?"READY":"FORMING"}</span><span className="muted">{t.member_count}/{t.max_size} spots</span></div>
                  <h3>{t.name}</h3>
                  <p>Led by {t.leader_name}</p>
                  <div className="capacity"><div style={{width:(100*t.member_count/t.max_size)+"%"}}/></div>
                  {t.member_count<t.max_size&&!current?
                    <button disabled={busy} onClick={()=>run(()=>post("/teams/"+t.id+"/requests"))}>Request to join ↗</button>:
                    <button disabled className="ghost">{current?"Already on a team":"Team full"}</button>}
                </article>)}
              </div>
              {board.length===0&&<div className="empty">No teams match. Create the first one!</div>}
              <div className="pager"><button disabled={page===0} onClick={()=>setPage(page-1)}>← Previous</button><span>Page {page+1}</span><button disabled={board.length<30} onClick={()=>setPage(page+1)}>Next →</button></div>
            </section>
          </div>
        </div>}
      <footer>TEAMFORGE · Hack4Hack Crew Hiring Challenge 2026 · PostgreSQL-enforced concurrency</footer>
    </main>
  </div>;
}
createRoot(document.getElementById("root")).render(<App/>);
