import {createContext,useContext,useEffect,useState,useCallback,useRef} from "react";
import {BrowserRouter,Routes,Route,Link,NavLink,Navigate,useNavigate,useLocation,useParams} from "react-router-dom";
import {AnimatePresence,motion,useReducedMotion} from "framer-motion";
import {LiveKitRoom, VideoConference} from "@livekit/components-react";

const API = (import.meta.env.VITE_API || (import.meta.env.DEV ? "http://localhost:8000" : "")).replace(/\/+$/, "");
const API_TIMEOUT_MS = 30000;
const Ctx = createContext(); const useAuth = () => useContext(Ctx);

async function call(path,{method="GET",body,form,timeout=API_TIMEOUT_MS}={}) {
  if (!API) throw new Error("Backend URL is not configured. Set VITE_API in the Vercel project environment variables.");
  const t = localStorage.getItem("tok"), h = {};
  if (t) h.Authorization = "Bearer " + t;
  if (body) h["Content-Type"] = "application/json";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let r;
  try {
    r = await fetch(API+path,{method,headers:h,body:form||(body&&JSON.stringify(body)),signal:controller.signal});
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The server took too long to respond. Please try again.");
    throw new Error("Cannot reach the Matchly server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  if (r.status===401 && t) { localStorage.removeItem("tok");localStorage.removeItem("user"); location.href="/login"; }
  const d = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(typeof d.detail==="string" ? d.detail : Array.isArray(d.detail) ? d.detail.map(x=>x.msg).join(", ") : `Request failed (${r.status}). Please try again.`);
  return d;
}
const useNote = () => { const [n,setN]=useState(); return [n, (m,t="ok")=>setN({m,t}), (e)=>setN({m:e.message,t:"err"})]; };
const Note = ({n}) => n ? <div className={"note "+n.t} role="status">{n.m}</div> : null;

function Provider({children}) {
  const [user,setUser] = useState(()=>JSON.parse(localStorage.getItem("user")||"null"));
  const login = d => { localStorage.setItem("tok",d.token); localStorage.setItem("user",JSON.stringify(d)); setUser(d); };
  const logout = () => { localStorage.removeItem("tok");localStorage.removeItem("user"); setUser(null); };
  return <Ctx.Provider value={{user,login,logout}}>{children}</Ctx.Provider>;
}
const Guard = ({role,children}) => { const {user}=useAuth(); const loc=useLocation();
  if(!user){ sessionStorage.setItem("next",loc.pathname); return <Navigate to="/login"/>; }
  return [].concat(role).includes(user.role) ? children : <Navigate to="/"/>; };
const home = r => ({candidate:"/dashboard",recruiter:"/recruiter/dashboard",admin:"/admin"})[r];

function ThemeToggle() {
  const [dark,setDark]=useState(()=>{ try { return localStorage.getItem("theme")!=="light"; } catch { return document.documentElement.dataset.theme!=="light"; } });
  useEffect(()=>{ document.documentElement.dataset.theme=dark?"dark":"light"; try{localStorage.setItem("theme",dark?"dark":"light");}catch{} },[dark]);
  return <button className="themebtn" onClick={()=>setDark(!dark)} aria-pressed={dark} aria-label={dark?"Switch to light mode":"Switch to dark mode"}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><mask id="tt-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle className="tt-cut" cx="24" cy="0" r="8" fill="#000"/></mask>
      <g mask="url(#tt-mask)"><circle className="tt-core" cx="12" cy="12" r="5" fill="currentColor"/></g>
      <g className="tt-rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">{[0,45,90,135,180,225,270,315].map(a=><line key={a} x1="12" y1="2" x2="12" y2="4.5" transform={`rotate(${a} 12 12)`}/>)}</g></svg></button>;
}

function Nav() {
  const {user,logout}=useAuth(); const nav=useNavigate(); const {pathname}=useLocation(); const front=!user&&pathname==="/";
  if(user) return null;
  return <nav className="glass"><Link className="logo" to="/">Matchly</Link>
    {!user && <Link to="/jobs">Jobs</Link>}
    {user?.role==="candidate" && <Bell/>}
    {user ? <button className="ghost" onClick={()=>{logout();nav("/");}}>Log out</button> : !front && <><Link to="/login">Log in</Link><Link to="/register">Sign up</Link></>}
    <ThemeToggle/>
  </nav>;
}

function Tilt({children,className="",style,flat}) {
  const ref=useRef();
  const move=e=>{ const el=ref.current, r=el.getBoundingClientRect(), x=(e.clientX-r.left)/r.width, y=(e.clientY-r.top)/r.height;
    el.style.setProperty("--mx",x*100+"%"); el.style.setProperty("--my",y*100+"%");
    if(!flat){ el.style.setProperty("--rx",((.5-y)*9)+"deg"); el.style.setProperty("--ry",((x-.5)*11)+"deg"); } };
  const leave=()=>{ const el=ref.current; el.style.setProperty("--rx","0deg"); el.style.setProperty("--ry","0deg"); };
  return <motion.div ref={ref} className={"tilt glass "+className} style={style}
    onMouseMove={move} onMouseLeave={leave}
    whileHover={flat?{y:-2}:{y:-5,scale:1.012}}
    whileTap={{scale:.992}}
    transition={{type:"spring",stiffness:280,damping:22}}>
    {children}
  </motion.div>;
}
function Reveal({children,delay=0,lazy}) {
  const ref=useRef(); const [on,setOn]=useState(false);
  useEffect(()=>{ const el=ref.current; if(!el) return; if(!("IntersectionObserver" in window)){ setOn(true); return; }
    const io=new IntersectionObserver(([e])=>{ if(e.isIntersecting){ setOn(true); io.disconnect(); } },{threshold:.2}); io.observe(el); return ()=>io.disconnect(); },[]);
  return <div ref={ref} className={"reveal"+(on?" in":"")} style={{transitionDelay:delay+"ms"}}>{(on||!lazy)&&children}</div>;
}
function Sections({st}) {
  const steps=[["1","Upload your resume","We read it with OCR and pull out your skills."],["2","See your match","Every job shows a match percentage and the skills you are missing."],["3","Apply with confidence","Matches of 70% or more are shortlisted and get a skills test by email."]];
  const roles=[["Job seekers","Scan your resume, see your match, and track every application."],["Recruiters","Ranked applicants, a drag and drop pipeline, and Excel export."],["Admins","Users, jobs and platform charts in one dashboard."]];
  return <div className="wrap sections">
    <Reveal><h2 className="center">How Matchly works</h2></Reveal>
    <div className="grid">{steps.map(([n,t,d],i)=><Reveal key={n} delay={i*120}><Tilt className="card"><span className="stepno">{n}</span><h3>{t}</h3><p className="muted">{d}</p></Tilt></Reveal>)}</div>
    {st&&<Reveal lazy><div className="statrow glass">{[["Open jobs",st.jobs],["Companies",st.companies],["Job seekers",st.seekers]].map(([l,v])=><div key={l}><div className="stat"><Count to={v}/></div><div className="muted">{l}</div></div>)}</div></Reveal>}
    <Reveal><h2 className="center">Made for everyone in hiring</h2></Reveal>
    <div className="grid">{roles.map(([t,d],i)=><Reveal key={t} delay={i*120}><Tilt className="card"><h3>{t}</h3><p className="muted">{d}</p></Tilt></Reveal>)}</div>
    <Reveal><div className="cta"><h2>Ready to find your match?</h2><button className="small" onClick={()=>window.scrollTo({top:0,behavior:"smooth"})}>Log in or sign up</button></div></Reveal></div>;
}

function Front() {
  const [space,setSpace]=useState("seeker"), [mode,setMode]=useState("login");
  const lines={seeker:"Find jobs that fit your skills.",recruiter:"Hire people who match.",admin:"Keep the platform running."};
  const skills=["Python","FastAPI","MySQL","Docker"];
  return <><div className="wrap split" data-space={space}>
    <div><h1 className="rise">Upload your resume.<br/><span className="grad">See which jobs fit.</span></h1>
      <p className="muted rise" style={{maxWidth:470,fontSize:"1.1rem",animationDelay:".15s"}}>Matchly reads your resume, matches it to jobs, and tracks every application.</p>
      <div className="stage" aria-hidden="true">
        <div className="fc s1"><Tilt className="rsm"><div className="beam"/><div className="muted" style={{fontSize:".75rem"}}>Resume preview</div><div className="ln"/><div className="ln"/><div className="ln"/><div className="ln"/><div className="ln"/></Tilt></div>
        <div className="fc s2"><Tilt><div className="head"><Avatar n="NovaTech"/><div style={{flex:1}}><b>Backend Developer</b><div className="muted" style={{fontSize:".8rem"}}>NovaTech · Remote</div></div><Badge s={82}/></div><div className="meter"><b style={{width:"82%"}}/></div><Tags a={["Python","FastAPI","MySQL"]}/></Tilt></div>
        <div className="fc s3"><Tilt><div className="head"><Avatar n="Alex"/><div style={{flex:1}}><b>Alex Morgan</b><div className="muted" style={{fontSize:".8rem"}}>Candidate profile</div></div></div><div className="meter"><b style={{width:"100%"}}/></div><Tags a={["Python","Git"]} cls="ok"/><Tags a={["Docker"]} cls="no"/></Tilt></div>
      </div></div>
    <Tilt flat className="authpanel rise" style={{animationDelay:".2s"}}>
      <div className="roles" role="tablist">{[["seeker","Job seeker"],["recruiter","Recruiter"],["admin","Admin"]].map(([k,t])=><button key={k} role="tab" aria-selected={space===k} className={space===k?"on":""} onClick={()=>{setSpace(k);setMode("login");}}>{t}</button>)}
        <i className="slider" style={{transform:`translateX(${["seeker","recruiter","admin"].indexOf(space)*100}%)`}}/></div>
      <p className="muted line" key={space}>{lines[space]}</p>
      <Auth key={space+mode} mode={mode} space={space} embedded/>
      <p className="muted switch">{space==="admin" ? "Admin accounts are created by the platform owner." : <>{mode==="login"?"New here? ":"Already have an account? "}<a href="#" onClick={e=>{e.preventDefault();setMode(mode==="login"?"register":"login");}}>{mode==="login"?"Create an account":"Log in"}</a></>}</p>
      <p className="muted switch"><Link to="/jobs">Browse jobs</Link> without an account</p></Tilt></div><Sections/></>;
}

function Landing() {
  const {user}=useAuth();
  if(!user) return <Front/>;
  return <div className="wrap" style={{paddingTop:60}}>
    <h1 className="rise">Upload your resume.<br/>See which jobs fit.</h1>
    <p style={{maxWidth:520,fontSize:"1.15rem"}} className="muted">Matchly reads your resume, compares your skills with each job, and shows what you already match and what to learn next.</p>
    <div className="row" style={{maxWidth:360,marginTop:20}}>
      <Link to={user?home(user.role):"/register"}><button>{user?"Open dashboard":"Create free account"}</button></Link>
      <Link to="/jobs"><button className="ghost">Browse jobs</button></Link></div>
    <div className="glass card preview float"><div className="muted">Backend Developer · NovaTech</div><div className="score">82% match</div>
      <div className="meter"><b style={{width:"82%"}}/></div><Tags a={["Python","FastAPI","MySQL"]} cls="ok"/><Tags a={["Docker"]} cls="no"/></div>
    <div className="grid" style={{marginTop:50}}>
      {[["Job seekers","Scan your resume, fix any mistakes, search jobs and track every application."],["Recruiters","Post jobs, filter applicants by skill and move them through your hiring steps."],["Admins","Keep the platform clean by managing users and job postings."]].map(([t,d])=>
        <div key={t} className="glass card lift"><h3>{t}</h3><p className="muted">{d}</p></div>)}</div></div>;
}

function Auth({mode,embedded,space}) {
  const {login}=useAuth(), nav=useNavigate();
  const reg=mode==="register";
  const reduceMotion=useReducedMotion();

  const [f,setF]=useState({
    name:"",
    email:"",
    password:"",
    role:space==="recruiter"?"recruiter":"candidate",
    company:""
  });
  const [n,ok,err]=useNote();
  const [busy,setBusy]=useState(false);
  const [step,setStep]=useState("form");
  const [code,setCode]=useState("");
  const [wait,setWait]=useState(0);
  const [life,setLife]=useState(0);

  const set=k=>e=>setF({...f,[k]:e.target.value});

  useEffect(()=>{
    if(step!=="otp") return;
    const t=setInterval(()=>{
      setWait(v=>Math.max(0,v-1));
      setLife(v=>Math.max(0,v-1));
    },1000);
    return ()=>clearInterval(t);
  },[step]);

  const enter=d=>{
    login(d);
    const nx=sessionStorage.getItem("next");
    sessionStorage.removeItem("next");
    nav(nx&&d.role==="candidate"?nx:home(d.role));
  };

  const sentNote=r=>ok(
    r.delivery==="terminal"
      ? "Email sending is not set up yet, so the code was printed in the backend terminal."
      : r.message
  );

  const submit=async e=>{
    e.preventDefault();
    setBusy(true);
    try {
      if(reg) {
        const r=await call("/auth/register",{method:"POST",body:f});
        setStep("otp");
        setCode("");
        setWait(60);
        setLife(r.minutes*60);
        sentNote(r);
      } else {
        enter(await call("/auth/login",{
          method:"POST",
          body:{email:f.email,password:f.password,role:space}
        }));
      }
    } catch(x) {
      err(x);
    } finally {
      setBusy(false);
    }
  };

  const verify=async e=>{
    e.preventDefault();
    setBusy(true);
    try {
      enter(await call("/auth/verify",{
        method:"POST",
        body:{email:f.email,code}
      }));
    } catch(x) {
      err(x);
    } finally {
      setBusy(false);
    }
  };

  const resend=async()=>{
    setBusy(true);
    try {
      const r=await call("/auth/resend",{method:"POST",body:{email:f.email}});
      setCode("");
      setWait(60);
      setLife(r.minutes*60);
      sentNote(r);
    } catch(x) {
      err(x);
    } finally {
      setBusy(false);
    }
  };

  const mm=String(Math.floor(life/60)).padStart(2,"0")+":"+String(life%60).padStart(2,"0");
  const initial=reduceMotion?{opacity:1}:{opacity:0,y:18,filter:"blur(8px)"};
  const animate={opacity:1,y:0,filter:"blur(0px)"};
  const exit=reduceMotion?{opacity:0}:{opacity:0,y:-12,filter:"blur(5px)"};
  const transition={duration:reduceMotion?0.01:0.35,ease:[0.22,1,0.36,1]};

  const otp=<form className={embedded?"authform":"glass card"} onSubmit={verify}>
    <Note n={n}/>
    <p className="muted" style={{margin:"4px 0 10px"}}>Enter the 6-digit code sent to <b>{f.email}</b>.</p>
    <label htmlFor="otp">Verification code</label>
    <input id="otp" className="otp" inputMode="numeric" autoComplete="one-time-code"
      maxLength={6} required autoFocus value={code}
      onChange={e=>setCode(e.target.value.replace(/\D/g,""))} placeholder="000000"/>
    <p className="muted" style={{fontSize:".85rem",margin:"8px 0 0"}}>
      {life>0?`Code expires in ${mm}`:"This code has expired. Request a new one."}
    </p>
    <motion.button type="submit" className={space?"small":""}
      style={space?{margin:"14px auto 0",display:"block"}:{marginTop:14,width:"100%"}}
      disabled={busy||code.length!==6||life===0}
      whileHover={reduceMotion?{}:{scale:1.035,y:-2}}
      whileTap={reduceMotion?{}:{scale:.97}}>
      {busy?"Checking...":"Verify and continue"}
    </motion.button>
    <p className="muted switch">
      <button type="button" className="linkbtn" disabled={busy||wait>0} onClick={resend}>
        {wait>0?`Resend code in ${wait}s`:"Resend code"}
      </button>
      {" · "}
      <button type="button" className="linkbtn" onClick={()=>{setStep("form");setCode("");}}>
        Change email
      </button>
    </p>
  </form>;

  const form=<form className={embedded?"authform":"glass card"} onSubmit={submit}>
    {!space&&<h2>{reg?"Create your account":"Welcome back"}</h2>}
    <Note n={n}/>
    {reg&&<>
      <label htmlFor="nm">Full name</label>
      <input id="nm" required value={f.name} onChange={set("name")}/>
      {!space&&<>
        <label htmlFor="rl">I am a</label>
        <select id="rl" value={f.role} onChange={set("role")}>
          <option value="candidate">Job seeker</option>
          <option value="recruiter">Recruiter</option>
        </select>
      </>}
      {f.role==="recruiter"&&<>
        <label htmlFor="co">Company name</label>
        <input id="co" value={f.company} onChange={set("company")}/>
      </>}
    </>}
    <label htmlFor="em">Email</label>
    <input id="em" type="email" required value={f.email} onChange={set("email")}/>
    <label htmlFor="pw">Password</label>
    <input id="pw" type="password" required minLength={reg?8:1}
      value={f.password} onChange={set("password")}/>
    <motion.button type="submit" className={space?"small":""}
      style={space?{margin:"16px auto 0",display:"block"}:{marginTop:16,width:"100%"}}
      disabled={busy}
      whileHover={reduceMotion?{}:{scale:1.045,y:-3}}
      whileTap={reduceMotion?{}:{scale:.96}}
      transition={{type:"spring",stiffness:350,damping:18}}>
      {busy?"Please wait...":reg?"Create account":"Log in"}
    </motion.button>
  </form>;

  const view=step==="otp"?otp:form;
  return <AnimatePresence mode="wait" initial={false}>
    <motion.div key={step+mode} initial={initial} animate={animate} exit={exit} transition={transition}>
      {embedded?view:<div className="wrap" style={{maxWidth:440}}>{view}</div>}
    </motion.div>
  </AnimatePresence>;
}

const Tags = ({a,cls}) => a.map(x=><span key={x} className={"tag "+(cls||"")}>{x}</span>);
const Avatar = ({n}) => <span className="avatar" aria-hidden="true">{(n||"?")[0]}</span>;
function Count({to}) { const [v,setV]=useState(0);
  useEffect(()=>{ let f,t0; const run=t=>{ t0??=t; const p=Math.min((t-t0)/800,1); setV(Math.round(to*(1-Math.pow(1-p,3)))); if(p<1) f=requestAnimationFrame(run); };
    f=requestAnimationFrame(run); return ()=>cancelAnimationFrame(f); },[to]); return v; }
const FLOW=["Applied","Under Review","Shortlisted","Interview","Selected"];
const Steps = ({s}) => { if(["Rejected","Withdrawn","Auto-rejected"].includes(s)) return <span className={"tag "+(s==="Withdrawn"?"":"no")}>{s}</span>;
  const i=FLOW.indexOf(s); return <div className="steps" aria-label={"Status: "+s}>{FLOW.map((x,k)=><div key={x} className={"step "+(k<=i?"on":"")}><i/><span>{x}</span></div>)}</div>; };

function Jobs() {
  const {user}=useAuth(); const sv=useSaved(); const [f,setF]=useState({q:new URLSearchParams(location.search).get("q")||"",location:"",job_type:"",exp:"",skill:"",sort:"new",page:1});
  const [d,setD]=useState(); const [sel,setSel]=useState(); const [an,setAn]=useState(); const [n,ok,err]=useNote();
  const load=useCallback(()=>{ const p=new URLSearchParams(Object.entries(f).filter(([,v])=>v!=="")); call("/jobs?"+p).then(setD).catch(err); },[f]);
  useEffect(load,[load]);
  useEffect(()=>{ const id=new URLSearchParams(location.search).get("job"); if(id) open(id); },[]);
  const set=k=>e=>setF({...f,[k]:e.target.value,page:1});
  const open = id => { setAn(null); call("/jobs/"+id).then(setSel).catch(err); };
  const analyze = () => call("/resume/analyze",{method:"POST",body:{job_id:sel.id}}).then(setAn).catch(err);
  const apply = () => call(`/jobs/${sel.id}/apply`,{method:"POST"}).then(r=>{ok(r.message,r.status==="Auto-rejected"?"err":"ok");setSel(null);window.scrollTo({top:0,behavior:"smooth"});}).catch(err);
  return <div className="wrap"><h2>Find your next job</h2><Note n={n}/>
    <div className="glass card row"><input aria-label="Keyword" placeholder="Keyword" value={f.q} onChange={set("q")}/>
      <input aria-label="Location" placeholder="Location" value={f.location} onChange={set("location")}/>
      <input aria-label="Skill" placeholder="Skill (e.g. React)" value={f.skill} onChange={set("skill")}/>
      <input aria-label="Years of experience" type="number" min="0" placeholder="Your years of experience" value={f.exp} onChange={set("exp")}/>
      <select aria-label="Job type" value={f.job_type} onChange={set("job_type")}><option value="">Any type</option>{["Full-time","Part-time","Contract","Internship"].map(t=><option key={t}>{t}</option>)}</select>
      <select aria-label="Sort" value={f.sort} onChange={set("sort")}><option value="new">Newest first</option><option value="exp">Lowest experience first</option></select></div>
    {!d ? <div className="grid">{[0,1,2,3,4,5].map(k=><div key={k} className="glass card skel"/>)}</div> : !d.items.length ? <div className="empty">No jobs match these filters. Try removing one.</div> :
      <div className="grid">{d.items.map((j,i)=><div key={j.id} className="glass card lift" style={{"--i":i}}><div className="head"><Avatar n={j.company}/><div style={{flex:1}}><h3>{j.title}</h3><div className="muted">{j.company} · {j.location}</div></div>{user?.role==="candidate"&&<Heart on={sv.has(j.id)} fn={()=>sv.toggle(j.id)}/>}</div>
        <div className="muted">{ago(j.created)} · {j.job_type} · {j.min_exp}-{j.max_exp} yrs{j.salary?` · ${j.salary}`:""}</div><div style={{margin:"8px 0"}}><Tags a={j.skills}/></div>
        <button onClick={()=>open(j.id)}>View details</button></div>)}</div>}
    {d && <div className="row" style={{justifyContent:"center",alignItems:"center",marginTop:16}}>
      <button className="ghost" disabled={f.page<=1} onClick={()=>setF({...f,page:f.page-1})}>Previous</button>
      <span style={{textAlign:"center"}}>Page {f.page} of {d.pages}</span>
      <button className="ghost" disabled={f.page>=d.pages} onClick={()=>setF({...f,page:f.page+1})}>Next</button></div>}
    {sel && <div className="modal" onClick={()=>setSel(null)}><div className="glass" onClick={e=>e.stopPropagation()}>
      <h2>{sel.title}</h2><div className="muted">{sel.company} · {sel.location} · {sel.job_type} · {sel.min_exp}-{sel.max_exp} yrs {sel.salary&&`· ${sel.salary}`}</div>
      <p style={{whiteSpace:"pre-wrap"}}>{sel.description}</p><Tags a={sel.skills}/>
      {an && <div className="card glass"><div className="score">{an.score}% match</div><div>Matched: <Tags a={an.matched} cls="ok"/>{!an.matched.length&&<span className="muted">None</span>}</div>
        <div>Missing: <Tags a={an.missing} cls="no"/>{!an.missing.length&&<span className="muted">None</span>}</div><p>{an.recommendation}</p></div>}
      {user?.role==="candidate"&&<p className="muted" style={{fontSize:".85rem"}}>Match 70% or more and you are shortlisted with a skills test. Below 70% is rejected automatically. Tap "Check my match" first.</p>}
      <div className="row" style={{marginTop:14}}>
        {user?.role==="candidate" ? <><button className="ghost" onClick={analyze}>Check my match</button><button onClick={apply}>Apply now</button></> :
          !user && <Link to="/login"><button>Log in to apply</button></Link>}
        <button className="ghost" onClick={()=>setSel(null)}>Close</button></div></div></div>}</div>;
}

function Resume() {
  const [p,setP]=useState(); const [n,ok,err]=useNote(); const [skills,setSk]=useState(""); const [resumeFile,setResumeFile]=useState(null); const [uploading,setUploading]=useState(false);
  const load=useCallback(()=>call("/resume/profile").then(d=>{setP(d);setSk(d.skills.join(", "));}).catch(err),[]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{ if(p?.resume?.status!=="processing") return; const t=setInterval(load,3000); return()=>clearInterval(t); },[p?.resume?.status]);
  const up = async () => {
    if(!resumeFile) return err("Please choose your resume first.");
    if(resumeFile.size>10*1024*1024) return err("File is larger than 10 MB.");
    const fd=new FormData(); fd.append("f",resumeFile); setUploading(true);
    try { await call("/resume/upload",{method:"POST",form:fd}); ok("Uploaded. Reading your resume..."); setResumeFile(null); load(); }
    catch(e) { err(e); } finally { setUploading(false); }
  };
  const save = e => { e.preventDefault(); call("/resume/profile",{method:"PUT",body:{...p,skills:skills.split(",").map(x=>x.trim()).filter(Boolean)}}).then(r=>ok(r.message)).catch(err); };
  if(!p) return <div className="wrap"><Note n={n}/><div className="empty"><span className="spin"/> Loading...</div></div>;
  const r=p.resume, set=k=>e=>setP({...p,[k]:e.target.value});
  const filled=[p.phone,p.education,p.experience,p.summary,skills].filter(x=>x&&x.trim()).length, pct=Math.round(100*filled/5);
  return <div className="wrap"><h2>My resume and profile</h2><Note n={n}/>
    <div className="glass card"><h3>Upload your resume</h3><p className="muted">Upload a PDF, JPG or PNG file (maximum 10 MB). We'll read it and fill in your profile details automatically.</p>
      <FileDropzone file={resumeFile} onFile={setResumeFile} disabled={uploading} accept=".pdf,.jpg,.jpeg,.png" extensions={["pdf","jpg","jpeg","png"]} title="Upload your resume" description="Drag and drop your PDF or image here" formats="PDF, JPG and PNG"/>
      <button style={{marginTop:14}} onClick={up} disabled={!resumeFile||uploading}>{uploading?"Uploading…":"Upload resume"}</button>
    </div>
    <form className="glass card" onSubmit={save}><p className="muted">{p.name} · {p.email}</p><div className="meter" role="progressbar" aria-valuenow={pct} aria-label="Profile completeness"><b style={{width:pct+"%"}}/></div><p className="muted">Profile {pct}% complete{pct<100&&". Fill in the empty fields to finish it."}</p>
      <label htmlFor="ph">Phone</label><input id="ph" value={p.phone} onChange={set("phone")}/>
      <label htmlFor="ed">Education</label><textarea id="ed" rows="2" value={p.education} onChange={set("education")}/>
      <label htmlFor="ex">Experience</label><textarea id="ex" rows="2" value={p.experience} onChange={set("experience")}/>
      <label htmlFor="sm">Summary</label><textarea id="sm" rows="2" value={p.summary} onChange={set("summary")}/>
      <label htmlFor="sk">Skills (comma separated)</label><input id="sk" value={skills} onChange={e=>setSk(e.target.value)}/>
      <button style={{marginTop:14}}>Save profile</button></form></div>;
}

function Applications() {
  const [a,setA]=useState(); const [n,ok,err]=useNote();
  const load=()=>call("/applications").then(setA).catch(err); useEffect(()=>{load();},[]);
  const wd=id=>call(`/applications/${id}/withdraw`,{method:"PUT"}).then(r=>{ok(r.message);load();}).catch(err);
  return <div className="wrap"><h2>My applications</h2><Note n={n}/>
    {!a?<div className="empty"><span className="spin"/></div>:!a.length?<div className="empty">You have not applied yet. <Link to="/jobs">Browse jobs</Link></div>:
    a.map((x,i)=><div key={x.id} className="glass card row lift" style={{alignItems:"center","--i":i}}><div><h3>{x.job.title}</h3><div className="muted">{x.job.company} · Applied {x.applied.slice(0,10)}</div></div>
      <div style={{flex:2,minWidth:260}}><Steps s={x.status}/>{x.test&&<TestChip t={x.test}/>}</div>
      <div>{["Applied","Under Review"].includes(x.status)&&<button className="danger" onClick={()=>wd(x.id)}>Withdraw</button>}</div></div>)}</div>;
}

const empty={title:"",description:"",location:"",min_exp:0,max_exp:2,job_type:"Full-time",salary:"",skills:"",status:"published"};
function Recruiter() {
  const [newFile,setNewFile]=useState(null); const [manageId,setManageId]=useState(null); const [manageFile,setManageFile]=useState(null); const [busy,setBusy]=useState(false); const [jobs,setJ]=useState([]); const [ap,setAp]=useState([]); const [j,setF]=useState(empty); const [co,setCo]=useState();
  const [fs,setFs]=useState({skill:"",min_exp:"",auto:""}); const [n,ok,err]=useNote();
  const [recordings,setRecordings]=useState([]); const [recordingsBusy,setRecordingsBusy]=useState(false);
  const loadRecordings=()=>{setRecordingsBusy(true);call("/recruiter/test-recordings").then(setRecordings).catch(err).finally(()=>setRecordingsBusy(false));};
  const load=()=>{ call("/recruiter/jobs").then(setJ).catch(err);
    call("/recruiter/applicants?"+new URLSearchParams(Object.entries(fs).filter(([,v])=>v!=="")).toString()).then(setAp).catch(err); };
  useEffect(()=>{load(); loadRecordings(); call("/recruiter/company").then(setCo).catch(err);},[]);
  useEffect(()=>{load();},[fs.auto]);
  const set=k=>e=>setF({...j,[k]:e.target.value});
  const post=async e=>{
    e.preventDefault(); setBusy(true);
    try {
      const created=await call("/jobs",{method:"POST",body:{...j,status:"draft",min_exp:+j.min_exp,max_exp:+j.max_exp,skills:j.skills.split(",").map(x=>x.trim()).filter(Boolean)}});
      let count=0;
      if(newFile) {
        const fd=new FormData(); fd.append("f",newFile);
        const result=await call(`/jobs/${created.id}/questions/import`,{method:"POST",form:fd});
        count=result.count;
      }
      if(j.status==="published" && count>=50) {
        await call(`/jobs/${created.id}/status`,{method:"PUT",body:{status:"published"}});
        ok(`Job published with ${count} questions.`);
      } else if(j.status==="published") {
        ok(`Job saved as draft. ${count}/50 questions uploaded. Add at least ${50-count} more to publish.`);
      } else ok(`Draft saved with ${count} questions.`);
      setF({...empty}); setNewFile(null); e.target.reset(); load();
    } catch(ex) { err(ex); load(); }
    finally {setBusy(false);}
  };
  const manage=async id=>{
    if(!manageFile){ok("Choose a CSV or Excel file first.","err");return;}
    setBusy(true);
    try {
      const fd=new FormData();fd.append("f",manageFile);
      const result=await call(`/jobs/${id}/questions/import`,{method:"POST",form:fd});
      ok(`Added ${result.added} questions. Total: ${result.count}/50.${result.skipped?` Skipped ${result.skipped} invalid rows.`:""}`);
      setManageFile(null);setManageId(null);load();
    }catch(ex){err(ex);}finally{setBusy(false);}
  };
  const jst=(id,s)=>call(`/jobs/${id}/status`,{method:"PUT",body:{status:s}}).then(()=>load()).catch(err);
  const ast=(id,s)=>call(`/applications/${id}/status`,{method:"PUT",body:{status:s}}).then(()=>{ok("Status updated");if(s==="Selected")confetti();load();}).catch(err);
  const view=id=>fetch(`${API}/resume/${id}/file`,{headers:{Authorization:"Bearer "+localStorage.getItem("tok")}}).then(r=>r.ok?r.blob():Promise.reject(new Error("Could not open resume"))).then(b=>window.open(URL.createObjectURL(b))).catch(err);
  return <div className="wrap"><h2>Recruiter dashboard</h2><Note n={n}/>
    <section className="glass card" style={{margin:"14px 0"}}>
      <div className="row" style={{alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
        <div><h3 style={{margin:"0 0 5px"}}>Test Session Recordings</h3><p className="muted" style={{margin:0}}>Secure recordings are available for 7 days after each test.</p></div>
        <button className="ghost small" onClick={loadRecordings} disabled={recordingsBusy}>{recordingsBusy?"Refreshing...":"Refresh"}</button>
      </div>
      {!recordings.length?<p className="muted" style={{marginTop:14}}>{recordingsBusy?"Loading recordings...":"No test recordings are available yet."}</p>:<div style={{display:"grid",gap:12,marginTop:14}}>
        {recordings.map(item=><article key={item.id} className="glass card" style={{padding:14}}>
          <div className="row" style={{justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
            <div><b>{item.candidate_name}</b><div className="muted">{item.candidate_email} · {item.job}</div>
              <div className="muted" style={{fontSize:".85rem"}}>Expires: {new Date(item.expires_at+"Z").toLocaleString()}</div></div>
            <button className="danger small" onClick={async()=>{if(!window.confirm("Permanently delete this test recording?"))return;try{await call(`/recruiter/test-recordings/${item.id}`,{method:"DELETE"});ok("Recording deleted");loadRecordings();}catch(e){err(e);}}}>Delete</button>
          </div>
          <video controls preload="none" src={item.playback_url} style={{width:"100%",maxHeight:360,marginTop:12,borderRadius:12,background:"#090b18"}}/>
        </article>)}
      </div>}
    </section>
    {co && <form className="glass card" onSubmit={e=>{e.preventDefault();call("/recruiter/company",{method:"PUT",body:co}).then(r=>ok(r.message)).catch(err);}}><h3>Company profile</h3>
      <div className="row"><input aria-label="Company name" required value={co.name} onChange={e=>setCo({...co,name:e.target.value})}/><input aria-label="Contact" placeholder="Contact email or phone" value={co.contact} onChange={e=>setCo({...co,contact:e.target.value})}/></div>
      <textarea aria-label="About" rows="2" placeholder="About the company" style={{marginTop:8}} value={co.description} onChange={e=>setCo({...co,description:e.target.value})}/><button style={{marginTop:8}}>Save company</button></form>}
    <form className="glass card" onSubmit={post}><h3>Post a job</h3>
      <div className="row"><input aria-label="Title" required placeholder="Job title" value={j.title} onChange={set("title")}/><input aria-label="Location" required placeholder="Location" value={j.location} onChange={set("location")}/></div>
      <textarea aria-label="Description" required rows="3" placeholder="Describe the role" style={{margin:"8px 0"}} value={j.description} onChange={set("description")}/>
      <div className="row"><input aria-label="Min years" type="number" min="0" value={j.min_exp} onChange={set("min_exp")}/><input aria-label="Max years" type="number" min="0" value={j.max_exp} onChange={set("max_exp")}/>
        <select aria-label="Type" value={j.job_type} onChange={set("job_type")}>{["Full-time","Part-time","Contract","Internship"].map(t=><option key={t}>{t}</option>)}</select>
        <input aria-label="Salary" placeholder="Salary (optional)" value={j.salary} onChange={set("salary")}/></div>
      <input aria-label="Skills" required placeholder="Required skills, comma separated" style={{margin:"8px 0"}} value={j.skills} onChange={set("skills")}/>
      <div style={{margin:"12px 0"}}><b>Job-specific MCQ questions</b><p className="muted">Upload a CSV or XLSX with columns: technology, question, option_a, option_b, option_c, option_d, answer. At least 50 valid questions are required to publish.</p>
      <FileDropzone file={newFile} onFile={setNewFile} disabled={busy}/></div>
      <select aria-label="Status" value={j.status} onChange={set("status")} style={{marginBottom:8}}><option value="published">Publish now</option><option value="draft">Save as draft</option></select><br/><button disabled={busy}>{busy?"Saving...":"Save job"}</button></form>
    <h3>My jobs</h3>{!jobs.length?<div className="empty">No jobs yet. Post your first one above.</div>:jobs.map(x=><div key={x.id} className="glass card row" style={{alignItems:"center"}}>
      <div><b>{x.title}</b><div className="muted">{x.location}</div></div><span className="tag">{x.status}</span>
      <div className="row">{x.status!=="disabled"&&(x.status==="published"?<button className="ghost" onClick={()=>jst(x.id,"closed")}>Close</button>:<button className="ghost" onClick={()=>jst(x.id,"published")}>Publish</button>)}
      <button className="ghost" onClick={()=>{setManageId(manageId===x.id?null:x.id);setManageFile(null);}}>Manage Questions</button>
      </div>
      {manageId===x.id&&<div className="glass card" style={{width:"100%",marginTop:12,background:"rgba(255,255,255,.72)",color:"#24153f"}}>
        <h4 style={{color:"#24153f",margin:"0 0 6px"}}>Question management · {x.title}</h4>
        <p style={{color:"#493b62",fontSize:".95rem",lineHeight:1.5}}>Upload or add to this job's own question set. Published jobs can receive additional questions; existing candidate tests keep their assigned questions.</p>
        <FileDropzone file={manageFile} onFile={setManageFile} disabled={busy}/>
        <button disabled={busy||!manageFile} onClick={()=>manage(x.id)}>{busy?"Uploading...":"Upload questions"}</button>
      </div>}</div>)}
    <h3>Applicants</h3><div className="glass card row"><input aria-label="Filter by skill" placeholder="Filter by skill" value={fs.skill} onChange={e=>setFs({...fs,skill:e.target.value})}/>
      <input aria-label="Min experience" type="number" min="0" placeholder="Min years" value={fs.min_exp} onChange={e=>setFs({...fs,min_exp:e.target.value})}/><button onClick={load}>Apply filters</button><button className="ghost" onClick={()=>exportXlsx(err)}>Export to Excel</button><button className="ghost" onClick={()=>setFs({...fs,auto:fs.auto?"":"1"})}>{fs.auto?"Show active applicants":"Show auto-rejected"}</button></div>
    {!ap.length?<div className="empty">No applicants match yet.</div>:<div className="glass card" style={{overflowX:"auto"}}><table><thead><tr><th>Candidate</th><th>Job</th><th>Match</th><th>Test</th><th>Skills</th><th>Status</th><th>Resume</th></tr></thead><tbody>
      {ap.map(a=><tr key={a.id}><td><b>{a.name}</b><div className="muted">{a.email}<br/>{a.experience||"Experience not provided"}</div></td><td>{a.job}</td><td><Badge s={a.score}/></td><td><TestScore t={a.test}/></td><td><Tags a={a.skills}/></td>
        <td><select aria-label="Status" value={a.status} onChange={e=>ast(a.id,e.target.value)} disabled={["Withdrawn","Auto-rejected"].includes(a.status)}>{["Applied","Under Review","Shortlisted","Interview","Selected","Rejected","Withdrawn","Auto-rejected"].map(s=><option key={s} disabled={s==="Withdrawn"||s==="Auto-rejected"}>{s}</option>)}</select></td>
        <td><button className="ghost" onClick={()=>view(a.resume_id)}>Open</button></td></tr>)}</tbody></table></div>}</div>;
}

function Admin() {
  const [s,setS]=useState(); const [t,setT]=useState(); const [hl,setHl]=useState();
  const [u,setU]=useState([]); const [j,setJ]=useState([]);
  const [candidates,setCandidates]=useState([]); const [companies,setCompanies]=useState([]);
  const [applications,setApplications]=useState([]); const [resumes,setResumes]=useState([]);
  const [tab,setTab]=useState("overview"); const [filter,setFilter]=useState("");
  const [n,ok,err]=useNote();
  const load=()=>{
    call("/admin/analytics").then(setS).catch(err); call("/admin/trends").then(setT).catch(err);
    call("/admin/health").then(setHl).catch(err); call("/admin/users").then(setU).catch(err);
    call("/admin/jobs").then(setJ).catch(err); call("/admin/candidates").then(setCandidates).catch(err);
    call("/admin/companies").then(setCompanies).catch(err); call("/admin/applications").then(setApplications).catch(err);
    call("/admin/resumes").then(setResumes).catch(err);
  };
  useEffect(()=>{load();},[]);
  const tog=x=>call(`/admin/users/${x.id}/active`,{method:"PUT",body:{active:!x.active}}).then(()=>{ok("Account updated");load();}).catch(err);
  const jb=(id,st)=>call(`/jobs/${id}/status`,{method:"PUT",body:{status:st}}).then(()=>{ok("Job status updated");load();}).catch(err);
  const openResume=id=>fetch(API+`/resume/${id}/file`,{headers:{Authorization:"Bearer "+localStorage.getItem("tok")}})
    .then(async r=>{if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.detail||"Could not open resume");}return r.blob();})
    .then(b=>{const url=URL.createObjectURL(b);window.open(url,"_blank","noopener,noreferrer");}).catch(err);
  const tabs=[["overview","Overview"],["seekers","Job seekers"],["companies","Companies & recruiters"],["jobs","Job listings"],["applications","Applications"],["resumes","Resume center"],["users","User accounts"]];
  const shownApps=applications.filter(a=>!filter||a.status===filter);
  return <div className="wrap"><h2>Admin Control Center</h2><p className="muted">Platform-wide visibility across candidates, companies, recruiters, jobs, resumes and hiring activity.</p><Note n={n}/>
    <div className="glass card" style={{padding:10,marginBottom:18}}><div className="row" style={{gap:8,flexWrap:"wrap"}}>{tabs.map(([id,label])=><button key={id} className={tab===id?"small":"ghost small"} onClick={()=>setTab(id)}>{label}</button>)}</div></div>
    {tab==="overview"&&<>
      {s&&<div className="grid4"><Stat i={0} icon="user" label="Total users" value={s.users} delta={s.users_delta}/><Stat i={1} icon="brief" label="Open jobs" value={s.active_jobs}/><Stat i={2} icon="file" label="Applications" value={s.applications} delta={s.applications_delta}/><Stat i={3} icon="shield" label="Auto-reject rate" value={s.applications?Math.round(100*s.auto_rejected/s.applications):0} suffix="%"/></div>}
      <div className="grid4"><Stat i={0} icon="user" label="Job seekers" value={candidates.length}/><Stat i={1} icon="brief" label="Companies" value={companies.length}/><Stat i={2} icon="file" label="Resumes" value={resumes.length}/><Stat i={3} icon="check" label="Shortlisted" value={applications.filter(a=>a.status==="Shortlisted").length}/></div>
      <div className="dgrid"><div className="glass card"><h3>Applications · last 14 days</h3>{t&&<Area id="ad" labels={t.labels} data={t.applications}/>}</div><div className="glass card"><h3>Platform users</h3><Donut pct={s?.users?Math.round(100*s.candidates/s.users):0} label="Job seekers"/><div className="legend"><div><i className="on"/>Job seekers<b>{s?.candidates||0}</b></div><div><i className="on"/>Recruiters<b>{s?.recruiters||0}</b></div></div></div></div>
      <div className="dgrid2"><div className="glass card"><h3>Signups · last 14 days</h3>{t&&<Area id="as" labels={t.labels} data={t.signups}/>}</div><Feed title="Recent registrations" items={s?.recent||[]} empty="No recent users."/><div className="glass card"><h3>System health</h3>{hl?[["API services",hl.api],["Database",hl.database],["Storage",hl.storage]].map(([l,up])=><div key={l} className="srow"><i className={"dot2"+(up?" ok":"")}/>{l}<span>{up?"Operational":"Down"}</span></div>):<p className="muted">Checking...</p>}{hl&&<p className="muted">{hl.files} resume files · {hl.mb} MB</p>}</div></div>
    </>}
    {tab==="seekers"&&<><h3>All job seekers ({candidates.length})</h3>{!candidates.length?<p className="muted">No job seekers found.</p>:candidates.map(x=><div className="glass card" key={x.id}><div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}><div><h3 style={{margin:0}}>{x.name}</h3><div className="muted">{x.email} · {x.phone||"No phone"}</div></div><span className={"tag "+(x.active?"ok":"no")}>{x.active?"Active":"Disabled"}</span></div><div className="grid" style={{marginTop:12}}><div><b>Education</b><p className="muted">{x.education||"Not provided"}</p></div><div><b>Experience</b><p className="muted">{x.experience||"Not provided"}</p></div><div><b>Summary</b><p className="muted">{x.summary||"Not provided"}</p></div></div><b>Skills</b><Tags a={x.skills||[]}/><p className="muted">Applications: {x.applications} · Shortlisted: {x.shortlisted} · Selected: {x.selected}</p><b>Resumes</b>{!x.resumes?.length?<p className="muted">No resume uploaded.</p>:x.resumes.map(r=><div className="row" key={r.id} style={{justifyContent:"space-between",marginTop:7}}><span>{r.filename} · {r.status}</span><button className="ghost small" onClick={()=>openResume(r.id)}>View resume</button></div>)}</div>)}</>}
    {tab==="companies"&&<><h3>Companies and recruiters ({companies.length})</h3>{companies.map(co=><div className="glass card" key={co.id}><h3>{co.name}</h3><p className="muted">{co.description||"No company description"}</p><p>Contact: {co.contact||"Not provided"} · Recruiters: {co.recruiter_count} · Jobs: {co.job_count}</p><b>Recruiter accounts</b>{co.recruiters.map(r=><div className="row" key={r.id} style={{justifyContent:"space-between"}}><span>{r.name} · {r.email}</span><span className="tag">{r.active?"Active":"Disabled"}</span></div>)}<b style={{display:"block",marginTop:12}}>Job listings</b>{co.jobs.map(jb=><div key={jb.id} className="row" style={{justifyContent:"space-between",flexWrap:"wrap"}}><span>{jb.title} · {jb.status}</span><span className="muted">{jb.applications} applied · {jb.shortlisted} shortlisted · {jb.selected} selected</span></div>)}</div>)}</>}
    {tab==="jobs"&&<><h3>All job listings ({j.length})</h3><div className="glass card" style={{overflowX:"auto"}}><table><thead><tr><th>Job</th><th>Company</th><th>Status</th><th>Actions</th></tr></thead><tbody>{j.map(x=><tr key={x.id}><td>{x.title}<div className="muted">{x.location} · {x.job_type}</div><div className="muted">{(x.skills||[]).join(", ")}</div></td><td>{x.company}</td><td>{x.status}</td><td>{x.status==="disabled"?<button className="ghost small" onClick={()=>jb(x.id,"published")}>Approve</button>:<button className="danger small" onClick={()=>jb(x.id,"disabled")}>Disable</button>}</td></tr>)}</tbody></table></div></>}
    {tab==="applications"&&<><h3>All applications ({applications.length})</h3><div className="row" style={{marginBottom:12}}><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All statuses</option>{["Applied","Under Review","Shortlisted","Interview","Selected","Rejected","Auto-rejected","Withdrawn"].map(v=><option key={v}>{v}</option>)}</select></div><div className="glass card" style={{overflowX:"auto"}}><table><thead><tr><th>Candidate</th><th>Job / Company</th><th>ATS match</th><th>Status</th><th>Test</th><th>Resume</th></tr></thead><tbody>{shownApps.map(a=><tr key={a.id}><td><b>{a.candidate.name}</b><div className="muted">{a.candidate.email}</div></td><td>{a.job.title}<div className="muted">{a.company}</div></td><td>{a.match_score==null?"—":a.match_score+"%"}</td><td><span className="tag">{a.status}</span></td><td>{a.test?(a.test.status==="completed"?`${a.test.score}/${a.test.total}`:a.test.status):"—"}</td><td>{a.resume_id&&<button className="ghost small" onClick={()=>openResume(a.resume_id)}>View</button>}</td></tr>)}</tbody></table></div></>}
    {tab==="resumes"&&<><h3>Resume Center ({resumes.length})</h3><div className="glass card" style={{overflowX:"auto"}}><table><thead><tr><th>Candidate</th><th>Resume</th><th>Status</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>{resumes.map(r=><tr key={r.id}><td>{r.candidate_name}<div className="muted">{r.candidate_email}</div></td><td>{r.filename}</td><td>{r.status}</td><td>{r.uploaded?new Date(r.uploaded).toLocaleString():"—"}</td><td><button className="ghost small" onClick={()=>openResume(r.id)}>Open resume</button></td></tr>)}</tbody></table></div></>}
    {tab==="users"&&<><h3>User accounts ({u.length})</h3><div className="glass card" style={{overflowX:"auto"}}><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{u.map(x=><tr key={x.id}><td>{x.name}</td><td>{x.email}</td><td>{x.role}</td><td>{x.active?"Active":"Disabled"}</td><td>{x.role!=="admin"&&<button className={x.active?"danger small":"ghost small"} onClick={()=>tog(x)}>{x.active?"Disable":"Enable"}</button>}</td></tr>)}</tbody></table></div></>}
  </div>;
}

const ago = d => { if(!d) return ""; const m=(Date.now()-new Date(d+"Z"))/6e4; return m<60?"Posted just now":m<1440?"Posted "+Math.floor(m/60)+"h ago":"Posted "+Math.floor(m/1440)+"d ago"; };
const Badge = ({s}) => s==null ? <span className="badge n">n/a</span> : <span className={"badge "+(s>=70?"g":s>=40?"y":"r")}>{s}%</span>;
const Heart = ({on,fn}) => <button className={"heart "+(on?"on":"")} onClick={fn} aria-pressed={!!on} aria-label={on?"Remove from saved":"Save job"}><svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button>;
function useSaved() { const {user}=useAuth(); const [ids,setIds]=useState(new Set());
  useEffect(()=>{ if(user?.role==="candidate") call("/saved").then(l=>setIds(new Set(l.map(x=>x.id)))).catch(()=>{}); },[user]);
  return {has:id=>ids.has(id), toggle:id=>call(`/jobs/${id}/save`,{method:"POST"}).then(r=>setIds(p=>{const n=new Set(p); r.saved?n.add(id):n.delete(id); return n;})).catch(()=>{})}; }
function confetti() { const c=["#6a5acd","#7fd8c0","#ffb5a0","#bfe0ff","#c9b8ff"], box=document.createElement("div"); box.className="confetti";
  for(let i=0;i<50;i++){ const p=document.createElement("i"); p.style.cssText=`left:${Math.random()*100}vw;background:${c[i%5]};animation-delay:${Math.random()*.4}s;--dx:${Math.random()*200-100}px`; box.appendChild(p); }
  document.body.appendChild(box); setTimeout(()=>box.remove(),2600); }
const Chart = ({labels,data,alt}) => { const mx=Math.max(1,...data); return <div><div className="chart">{data.map((v,i)=><i key={i} className={alt?"alt":""} style={{height:(v/mx*100)+"%",animationDelay:i*40+"ms"}} title={`${labels[i]}: ${v}`}/>)}</div><div className="chartlab"><span>{labels[0]}</span><span>{labels[labels.length-1]}</span></div></div>; };
const HBars = ({items}) => { const mx=Math.max(1,...items.map(x=>x.value)); return items.map(x=><div key={x.label} className="hb"><span title={x.label}>{x.label}</span><div className="meter"><b style={{width:(x.value/mx*100)+"%"}}/></div><em>{x.value}</em></div>); };
const authFetch = (path,err,fn) => fetch(API+path,{headers:{Authorization:"Bearer "+localStorage.getItem("tok")}}).then(async r=>{ if(r.ok) return r.blob(); const d=await r.json().catch(()=>({})); throw new Error(d.detail||"The server could not create the file (status "+r.status+"). Check the backend terminal for the error."); }).then(fn).catch(err);
const exportXlsx = err => authFetch("/recruiter/export",err,b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="applicants.xlsx"; document.body.appendChild(a); a.click(); a.remove(); });

function Bell() {
  const [d,setD]=useState({unread:0,items:[]}); const [open,setOpen]=useState(false); const [toast,setToast]=useState(null);
  const prev=useRef(null), box=useRef();
  const load=()=>call("/notifications").then(r=>{
    if(prev.current!==null && r.unread>prev.current && r.items[0]) { setToast(r.items[0].message); setTimeout(()=>setToast(null),5000); }
    prev.current=r.unread; setD(r); }).catch(()=>{});
  useEffect(()=>{ load(); const t=setInterval(load,15000); return ()=>clearInterval(t); },[]);
  useEffect(()=>{ if(!open) return;
    const out=e=>{ if(box.current&&!box.current.contains(e.target)) setOpen(false); }, esc=e=>{ if(e.key==="Escape") setOpen(false); };
    document.addEventListener("mousedown",out); document.addEventListener("keydown",esc);
    return ()=>{ document.removeEventListener("mousedown",out); document.removeEventListener("keydown",esc); }; },[open]);
  const toggle=()=>{ setOpen(!open); setToast(null);
    if(!open&&d.unread){ prev.current=0; setD(x=>({...x,unread:0})); call("/notifications/read",{method:"PUT"}).then(()=>setTimeout(load,2500)).catch(()=>{}); } };
  return <div className="bellwrap" ref={box}><button className={"themebtn"+(d.unread>0?" ring":"")} onClick={toggle} aria-expanded={open} aria-label={"Notifications, "+d.unread+" unread, "+d.items.length+" total"}>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>{(d.unread>0||d.items.length>0)&&<b className={"dot"+(d.unread>0?"":" seen")}>{d.unread>0?(d.unread>99?"99+":d.unread):(d.items.length>99?"99+":d.items.length)}</b>}</button>
    {toast&&!open&&<div className="glass toast" role="status" onClick={toggle}>{toast}</div>}
    {open&&<div className="glass drop"><div className="drophead"><b>Notifications</b><span>{d.items.length}</span></div>{!d.items.length?<p className="muted" style={{padding:12}}>No updates yet. You will see status changes here.</p>:d.items.map((x,k)=><div key={x.id} style={{"--i":k}} className={"nt "+(x.read?"":"new")}>{x.message}<small>{ago(x.created).replace("Posted ","")}</small></div>)}</div>}</div>;
}

const P={home:"M3 11l9-8 9 8M5 10v10h14V10",brief:"M4 8h16v11H4zM9 8V5h6v3M4 13h16",heart:"M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z",user:"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",file:"M7 3h7l5 5v13H7zM14 3v5h5",board:"M4 4h6v16H4zM14 4h6v10h-6z",out:"M9 4H5v16h4M16 8l4 4-4 4M20 12H9",search:"M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",target:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",check:"M5 12l5 5 9-10",shield:"M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"};
const Ico = ({n}) => <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]}/></svg>;
const JobsKey = () => { const l=useLocation(); return <Jobs key={l.search}/>; };

function Side() {
  const {user,logout}=useAuth(); const nav=useNavigate();
  const L={candidate:[["/dashboard","Dashboard","home"],["/jobs","Find jobs","search"],["/saved","Saved jobs","heart"],["/applications","Applications","file"],["/candidate/video-assessment","Video Assessment","file"],["/profile","My profile","user"],["/resume","Resume and edit","file"]],
    recruiter:[["/recruiter/dashboard","Dashboard","home"],["/recruiter/questions","Question Studio","target"],["/recruiter/pipeline","Pipeline","board"],["/recruiter/video-assessment","Video Assessment","file"],["/recruiter","Jobs and applicants","brief"],["/jobs","Browse jobs","search"]],
    admin:[["/admin","Dashboard","home"],["/questions","Question bank","file"],["/jobs","Browse jobs","search"]]}[user.role];
  return <aside className="glass side" aria-label="Main menu"><Link className="logo" to="/"><i className="mark"/>Matchly</Link>
    {L.map(([to,t,ic])=><NavLink key={to} to={to} end className={({isActive})=>isActive?"on":""}><Ico n={ic}/>{t}</NavLink>)}
    <div className="me"><Avatar n={user.name}/><div className="who2"><b>{user.name}</b><div className="muted">{user.role==="candidate"?"job seeker":user.role}</div></div>
      <button className="ghost" onClick={()=>{logout();nav("/");}} aria-label="Log out"><Ico n="out"/></button></div></aside>;
}
function Topbar() {
  const {user}=useAuth(); const nav=useNavigate(); const [q,setQ]=useState("");
  const h=new Date().getHours(), g=h<12?"Good morning":h<18?"Good afternoon":"Good evening";
  const sub={candidate:"Here is what is happening with your job search today.",recruiter:"Here is what is happening with your hiring today.",admin:"Here is what is happening on the platform today."}[user.role];
  return <header className="top"><div><h2>{g}, {user.name.split(" ")[0]}</h2><p className="muted">{sub}</p></div>
    <div className="tools"><form className="search glass" onSubmit={e=>{e.preventDefault();nav("/jobs?q="+encodeURIComponent(q));}}><Ico n="search"/><input aria-label="Search jobs" placeholder="Search jobs" value={q} onChange={e=>setQ(e.target.value)}/></form>
      {user.role==="candidate"&&<Bell/>}<ThemeToggle/></div></header>;
}
function Shell({children}) { const {user}=useAuth(); const {pathname}=useLocation(); return user && !pathname.startsWith("/test/") && !pathname.startsWith("/meeting/") ? <div className="shell"><Side/><main><Topbar/>{children}</main></div> : children; }

const Stat = ({icon,label,value,suffix="",delta,i=0}) => <div className="glass card stat2" style={{"--i":i}}><span className="ico-c"><Ico n={icon}/></span>
  <div><div className="muted">{label}</div><div className="stat"><Count to={value||0}/>{suffix}</div>{delta!=null&&<div className={"delta "+(delta>=0?"up":"down")}>{delta>=0?"\u2191":"\u2193"} {Math.abs(delta)}% vs last week</div>}</div></div>;
function Area({labels,data,id}) {
  const [h,setH]=useState(null); const W=600,H=180,pd=8, mx=Math.max(1,...data);
  const pts=data.map((v,i)=>[pd+i*(W-2*pd)/Math.max(1,data.length-1), H-pd-(v/mx)*(H-2*pd-14)]);
  const d=pts.map((p,i)=>i===0?`M${p[0]},${p[1]}`:`Q${pts[i-1][0]},${pts[i-1][1]} ${(pts[i-1][0]+p[0])/2},${(pts[i-1][1]+p[1])/2}`).join(" ")+` L${pts[pts.length-1][0]},${pts[pts.length-1][1]}`;
  const move=e=>{ const r=e.currentTarget.getBoundingClientRect(); setH(Math.max(0,Math.min(data.length-1,Math.round((e.clientX-r.left)/r.width*(data.length-1))))); };
  return <div className="area" onMouseMove={move} onMouseLeave={()=>setH(null)}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Trend chart"><defs><linearGradient id={"g"+id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff9be0" stopOpacity=".55"/><stop offset="1" stopColor="#6aa8ff" stopOpacity="0"/></linearGradient></defs>
      <path d={d+` L${W-pd},${H} L${pd},${H}Z`} fill={`url(#g${id})`}/><path d={d} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
      {h!=null&&<line x1={pts[h][0]} x2={pts[h][0]} y1="0" y2={H} stroke="rgba(255,255,255,.55)" vectorEffect="non-scaling-stroke"/>}</svg>
    {h!=null&&<><i className="pt" style={{left:pts[h][0]/W*100+"%",top:pts[h][1]/H*100+"%"}}/><div className="tip" style={{left:Math.min(85,Math.max(15,pts[h][0]/W*100))+"%"}}>{labels[h]}<b>{data[h]}</b></div></>}
    <div className="axis"><span>{labels[0]}</span><span>{labels[Math.floor(labels.length/2)]}</span><span>{labels[labels.length-1]}</span></div></div>;
}
const Donut = ({pct,label="Complete"}) => { const r=52,c=2*Math.PI*r; return <svg className="donut" viewBox="0 0 130 130" role="img" aria-label={pct+"% "+label}><defs><linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff9be0"/><stop offset="1" stopColor="#6aa8ff"/></linearGradient></defs>
  <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="12"/><circle className="arc" cx="65" cy="65" r={r} fill="none" stroke="url(#dg)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${c*pct/100} ${c}`} transform="rotate(-90 65 65)"/>
  <text x="65" y="64" textAnchor="middle" className="dnum">{pct}%</text><text x="65" y="82" textAnchor="middle" className="dlab">{label}</text></svg>; };
const Feed = ({title,items=[],empty="Nothing yet."}) => <div className="glass card"><h3>{title}</h3>{!items.length?<p className="muted">{empty}</p>:items.slice(0,4).map((x,i)=><div key={i} className="feed"><span className="ico-c sm"><Ico n="check"/></span><div>{x.message}<small>{x.created?ago(x.created).replace("Posted ",""):""}</small></div></div>)}</div>;

function Dashboard() {
  const [d,setD]=useState(); const [nt,setNt]=useState({items:[]}); const [n,ok,err]=useNote();
  useEffect(()=>{ call("/candidate/insights").then(setD).catch(err); call("/notifications").then(setNt).catch(()=>{}); },[]);
  if(!d) return <div className="wrap"><Note n={n}/><div className="grid4">{[0,1,2,3].map(k=><div key={k} className="glass card skel"/>)}</div></div>;
  const st=d.stats;
  return <div className="wrap"><Note n={n}/>
    <div className="grid4"><Stat i={0} icon="file" label="Applications" value={st.applications} delta={st.applications_delta}/><Stat i={1} icon="heart" label="Saved jobs" value={st.saved}/><Stat i={2} icon="user" label="Profile complete" value={st.profile} suffix="%"/><Stat i={3} icon="target" label="Average match" value={st.avg_match} suffix="%"/></div>
    <div className="dgrid"><div className="glass card"><h3>Your applications, last 14 days</h3><Area id="c1" labels={d.trend.labels} data={d.trend.data}/></div>
      <div className="glass card"><h3>Profile progress</h3><Donut pct={st.profile}/><div className="legend">{d.fields.map(f=><div key={f.label}><i className={f.done?"on":""}/>{f.label}<b>{f.done?"Done":"Missing"}</b></div>)}</div></div></div>
    <div className="dgrid"><div><h3>Best matches for you</h3>
      {!d.recommended.length ? <div className="empty">Add your skills to see jobs ranked by match. <Link to="/resume">Upload resume</Link></div> :
      <div className="grid">{d.recommended.slice(0,4).map((r,i)=><div key={r.job.id} className="glass card lift" style={{"--i":i}}>
        <div className="head"><Avatar n={r.job.company}/><div style={{flex:1}}><h3>{r.job.title}</h3><div className="muted">{r.job.company} · {r.job.location}</div></div><Badge s={r.score}/></div>
        <div className="meter"><b style={{width:r.score+"%"}}/></div>{r.missing.length>0&&<div className="muted">Missing: {r.missing.join(", ")}</div>}
        <Link to={"/jobs?job="+r.job.id}><button className="ghost small" style={{marginTop:10}}>View job</button></Link></div>)}</div>}</div>
      <div><Feed title="Notifications" items={nt.items} empty="No updates yet."/>
        <div className="glass card"><h3>Resume</h3>{d.resume?<div className="srow"><i className={"dot2"+(d.resume.status==="done"?" ok":"")}/>{d.resume.filename}<span>{d.resume.status==="done"?"Ready":d.resume.status==="processing"?"Reading":"Failed"}</span></div>:<p className="muted">No resume yet.</p>}
          <Link to="/resume"><button className="ghost small">Update resume</button></Link></div></div></div>
    <h3>Skills to learn next</h3>
    {!d.gaps.length ? <div className="empty">No gaps found yet. Add more skills to your profile.</div> :
    <div className="glass card"><HBars items={d.gaps.map(g=>({label:g.skill,value:g.count}))}/><p className="muted">Number of jobs close to your profile that ask for each skill.</p></div>}</div>;
}

function Saved() {
  const [l,setL]=useState(); const [n,ok,err]=useNote();
  useEffect(()=>{ call("/saved").then(setL).catch(err); },[]);
  const un=id=>call(`/jobs/${id}/save`,{method:"POST"}).then(()=>setL(l.filter(x=>x.id!==id))).catch(err);
  return <div className="wrap"><h2>Saved jobs</h2><Note n={n}/>
    {!l ? <div className="grid"><div className="glass card skel"/></div> : !l.length ? <div className="empty">Nothing saved yet. Tap the heart on a job to keep it here. <Link to="/jobs">Find jobs</Link></div> :
    <div className="grid">{l.map((j,i)=><div key={j.id} className="glass card lift" style={{"--i":i}}><div className="head"><Avatar n={j.company}/><div style={{flex:1}}><h3>{j.title}</h3><div className="muted">{j.company} · {j.location}</div></div><Heart on={true} fn={()=>un(j.id)}/></div>
      <div className="muted">{ago(j.created)} · {j.job_type}</div><div style={{margin:"8px 0"}}><Tags a={j.skills}/></div><Link to={"/jobs?job="+j.id}><button>View details</button></Link></div>)}</div>}</div>;
}

function Profile() {
  const [p,setP]=useState(); const [n,ok,err]=useNote();
  useEffect(()=>{ call("/resume/profile").then(setP).catch(err); },[]);
  if(!p) return <div className="wrap"><Note n={n}/><div className="glass card skel"/></div>;
  const rows=[["Email",p.email],["Phone",p.phone],["Education",p.education],["Experience",p.experience],["About",p.summary]];
  return <div className="wrap"><div className="glass card profile"><div className="head"><span className="avatar big">{p.name[0]}</span><div><h2 style={{margin:0}}>{p.name}</h2><div className="muted">Job seeker</div></div></div>
    <Note n={n}/><dl>{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v||<span className="muted">Not provided</span>}</dd></div>)}
      <div><dt>Skills</dt><dd>{p.skills.length?<Tags a={p.skills}/>:<span className="muted">Not provided</span>}</dd></div>
      <div><dt>Resume</dt><dd>{p.resume?<>{p.resume.filename} <button className="ghost" onClick={()=>authFetch(`/resume/${p.resume.id}/file`,err,b=>window.open(URL.createObjectURL(b)))}>View resume</button></>:<span className="muted">No resume uploaded</span>}</dd></div></dl>
    <Link to="/resume"><button>Edit profile</button></Link></div></div>;
}

function RDash() {
  const [d,setD]=useState(); const [n,ok,err]=useNote();
  useEffect(()=>{ call("/recruiter/stats").then(setD).catch(err); },[]);
  if(!d) return <div className="wrap"><Note n={n}/><div className="grid4">{[0,1,2,3].map(k=><div key={k} className="glass card skel"/>)}</div></div>;
  const by=Object.fromEntries(d.stages.map(x=>[x.label,x.value])), active=d.applicants-by["Auto-rejected"]-by["Withdrawn"], moved=active-by["Applied"], pct=active>0?Math.round(100*moved/active):0;
  return <div className="wrap"><Note n={n}/><div style={{textAlign:"right",marginBottom:12}}><button className="small" onClick={()=>exportXlsx(err)}>Export to Excel</button></div>
    <div className="grid4"><Stat i={0} icon="brief" label="Open jobs" value={d.active}/><Stat i={1} icon="user" label="Applicants" value={d.applicants} delta={d.applicants_delta}/><Stat i={2} icon="check" label="Shortlisted" value={d.shortlisted}/><Stat i={3} icon="target" label="Average match" value={d.avg_match} suffix="%"/></div>
    <div className="dgrid"><div className="glass card"><h3>Applicants, last 14 days</h3><Area id="r1" labels={d.trend.labels} data={d.trend.data}/></div>
      <div className="glass card"><h3>Hiring progress</h3><Donut pct={pct} label="Reviewed"/><div className="legend">{d.stages.filter(x=>x.value>0).map(x=><div key={x.label}><i className="on"/>{x.label}<b>{x.value}</b></div>)}</div></div></div>
    <div className="dgrid2"><div className="glass card"><h3>Applicants per job</h3>{d.per_job.length?<HBars items={d.per_job}/>:<div className="empty">No jobs yet</div>}</div>
      <Feed title="Recent applicants" items={d.recent} empty="No applicants yet."/>
      <div className="glass card"><h3>ATS screening</h3><div className="stat"><Count to={d.auto_rejected}/></div><p className="muted">Applications rejected automatically for a match below 70%.</p><Link to="/recruiter"><button className="ghost small">Review them</button></Link></div></div></div>;
}

const COLS=["Applied","Under Review","Shortlisted","Interview","Selected","Rejected"];
function Pipeline() {
  const [a,setA]=useState(); const [reviews,setReviews]=useState([]);
  const [n,ok,err]=useNote(); const [over,setOver]=useState();
  const load=()=>{
    call("/recruiter/applicants").then(setA).catch(err);
    call("/recruiter/proctoring/reviews").then(setReviews).catch(err);
  };
  useEffect(()=>{load();},[]);
  const drop=(e,col)=>{ e.preventDefault(); setOver(null); const id=+e.dataTransfer.getData("text"), x=a.find(z=>z.id===id); if(!x||x.status===col) return;
    setA(a.map(z=>z.id===id?{...z,status:col}:z));
    call(`/applications/${id}/status`,{method:"PUT",body:{status:col}}).then(()=>{ ok(`${x.name} moved to ${col}`); if(col==="Selected") confetti(); }).catch(er=>{ err(er); load(); }); };
  const reviewAction=async(testId,action)=>{
    const label=action==="reattempt"?"allow a fresh test attempt":"reject this application";
    if(!window.confirm(`Are you sure you want to ${label}?`)) return;
    try{
      const result=await call(`/recruiter/tests/${testId}/${action}`,{method:"POST"});
      ok(result.message);load();
    }catch(e){err(e);}
  };
  return <div className="wrap"><div className="row" style={{alignItems:"center"}}><div><h2>Hiring pipeline</h2><p className="muted" style={{margin:0}}>Drag a candidate to a new column to change their status.</p></div><div style={{textAlign:"right"}}><button className="ghost" onClick={()=>exportXlsx(err)}>Export to Excel</button></div></div><Note n={n}/>
    <section className="glass card" style={{marginTop:16}}>
      <div className="row" style={{alignItems:"center",justifyContent:"space-between"}}><div><h3 style={{margin:"0 0 5px"}}>Online exam review</h3><p className="muted" style={{margin:0}}>Three monitoring events stop an attempt and send it here for human review. Events are signals, not proof of misconduct.</p></div><button className="ghost small" onClick={load}>Refresh</button></div>
      {!reviews.length?<p className="muted">No attempts are currently awaiting review.</p>:reviews.map(r=><article key={r.test_id} className="glass card" style={{margin:"14px 0 0",background:"rgba(255,255,255,.55)"}}>
        <div className="row" style={{alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
          <div><b>{r.candidate_name}</b><div className="muted">{r.candidate_email} · {r.job}</div></div>
          <span className="tag no">{r.warning_count} warnings · Attempt #{r.test_id}</span>
        </div>
        <div style={{marginTop:10,display:"grid",gap:8}}>
          {r.events.map(ev=><div key={ev.id} style={{padding:10,borderRadius:10,background:"rgba(110,80,160,.08)"}}>
            <b>{ev.type.replaceAll("_"," ")}</b><div className="muted" style={{fontSize:".85rem"}}>{ev.created_at?new Date(ev.created_at+"Z").toLocaleString():"Time unavailable"}</div>
            <div>{ev.description}</div>
          </div>)}
        </div>
        <div className="row" style={{marginTop:12,flexWrap:"wrap"}}>
          <button className="small" onClick={()=>reviewAction(r.test_id,"reattempt")}>Allow Reattempt</button>
          <button className="danger small" onClick={()=>reviewAction(r.test_id,"disqualify")}>Disqualify</button>
        </div>
      </article>)}
    </section>
    {!a ? <div className="glass card skel"/> : <div className="board">{COLS.map(col=><div key={col} className={"col glass"+(over===col?" over":"")} onDragOver={e=>{e.preventDefault();setOver(col);}} onDragLeave={()=>setOver(null)} onDrop={e=>drop(e,col)}>
      <h4>{col} <span className="tag">{a.filter(x=>x.status===col).length}</span></h4>
      {a.filter(x=>x.status===col).map(x=><div key={x.id} className="kcard" draggable onDragStart={e=>e.dataTransfer.setData("text",String(x.id))}>
        <div className="head"><Avatar n={x.name}/><div style={{flex:1}}><b>{x.name}</b><div className="muted">{x.job}{x.test&&x.test.status==="completed"?` · Test ${x.test.score}/${x.test.total}`:x.test?.status==="flagged_for_review"?" · Review required":""}</div></div><Badge s={x.score}/></div></div>)}</div>)}</div>}</div>;
}

function CandidateVideoAssessment() {
  const [items,setItems]=useState([]); const [n,ok,err]=useNote();
  useEffect(()=>{call("/candidate/video-assessment").then(setItems).catch(err);},[]);
  return <div className="wrap"><h2>My Video Assessments</h2><p className="muted">Next-round assignments and recruiter meetings for your applications.</p><Note n={n}/>
    {!items.length?<div className="glass card"><p className="muted">No video assignments or meetings have been scheduled for you yet.</p></div>:<div style={{display:"grid",gap:14}}>{items.map(x=><article className="glass card" key={x.id}><span className="tag ok">{x.kind==="meeting"?"Meeting":"Video assignment"}</span><h3>{x.title}</h3><div className="muted">{x.job} · Recruiter: {x.recruiter_name}</div>{x.instructions&&<p style={{whiteSpace:"pre-wrap"}}>{x.instructions}</p>}{x.due_at&&<p className="muted">Submission deadline: {new Date(x.due_at+"Z").toLocaleString()}</p>}{x.meeting_at&&<p className="muted">Meeting time: {new Date(x.meeting_at+"Z").toLocaleString()}</p>}{x.kind==="meeting"&&x.livekit&&<Link to={`/meeting/${x.id}`}><button>Join Live Interview</button></Link>}{x.meeting_url&&<a href={x.meeting_url} target="_blank" rel="noreferrer"><button className="ghost">Optional external meeting</button></a>}</article>)}</div>}
  </div>;
}

function VideoAssessment() {
  const [rows,setRows]=useState([]); const [n,ok,err]=useNote();
  const [drafts,setDrafts]=useState({}); const [busy,setBusy]=useState(null);
  const load=()=>call("/recruiter/video-assessment/passed").then(setRows).catch(err);
  useEffect(()=>{load();},[]);
  const update=(id,patch)=>setDrafts(old=>({...old,[id]:{kind:"video_assignment",title:"",instructions:"",due_at:"",meeting_at:"",meeting_url:"",...old[id],...patch}}));
  const submit=async id=>{
    const d=drafts[id]||{}; setBusy(id);
    try {
      const body={application_id:id,kind:d.kind||"video_assignment",title:d.title||"",instructions:d.instructions||null,
        due_at:d.due_at?new Date(d.due_at).toISOString():null,
        meeting_at:d.meeting_at?new Date(d.meeting_at).toISOString():null,meeting_url:d.meeting_url||null};
      const r=await call("/recruiter/video-assessment/actions",{method:"POST",body});
      ok(r.message); update(id,{title:"",instructions:"",due_at:"",meeting_at:"",meeting_url:""}); load();
    } catch(e){err(e);} finally{setBusy(null);}
  };
  return <div className="wrap"><div className="row" style={{alignItems:"center",justifyContent:"space-between"}}><div><h2>Video Assessment</h2><p className="muted" style={{margin:0}}>Passed candidates ready for the next hiring round.</p></div><button className="ghost" onClick={load}>Refresh</button></div><Note n={n}/>
    {!rows.length?<div className="glass card" style={{marginTop:16}}><h3>Passed candidates</h3><p className="muted">No passed candidates are available yet. Candidates appear here after completing and passing their online test.</p></div>:
      <div style={{display:"grid",gap:16,marginTop:16}}>{rows.map(r=>{const d=drafts[r.application_id]||{kind:"video_assignment",title:"",instructions:"",due_at:"",meeting_at:"",meeting_url:""};return <article key={r.application_id} className="glass card">
        <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}><div><h3 style={{margin:"0 0 4px"}}>{r.candidate_name}</h3><div className="muted">{r.candidate_email} · {r.job}</div></div><span className="tag ok">Passed · {r.score}/{r.total}</span></div>
        <p className="muted" style={{fontSize:".85rem"}}>Passed on {new Date(r.passed_at+ (r.passed_at.endsWith("Z")?"":"Z")).toLocaleString()}</p>
        {r.actions?.length>0&&<div style={{display:"grid",gap:8,margin:"12px 0"}}><b>Previously created</b>{r.actions.map(a=><div key={a.id} style={{padding:12,borderRadius:12,background:"rgba(110,80,160,.09)"}}><b>{a.kind==="meeting"?"Joining meeting":"Video assignment"}: {a.title}</b>{a.instructions&&<p style={{margin:"5px 0"}}>{a.instructions}</p>}{a.due_at&&<div className="muted">Due: {new Date(a.due_at+"Z").toLocaleString()}</div>}{a.meeting_at&&<div className="muted">Meeting: {new Date(a.meeting_at+"Z").toLocaleString()}</div>}{a.kind==="meeting"&&a.livekit&&<Link to={`/meeting/${a.id}`}><button className="small">Join LiveKit interview</button></Link>}{a.meeting_url&&<a href={a.meeting_url} target="_blank" rel="noreferrer">Optional external meeting</a>}</div>)}</div>}
        <div style={{borderTop:"1px solid var(--line,rgba(100,100,150,.2))",paddingTop:14,marginTop:12}}><h4 style={{margin:"0 0 10px"}}>Create next-round step</h4>
          <label>Type</label><select value={d.kind} onChange={e=>update(r.application_id,{kind:e.target.value})}><option value="video_assignment">Video assignment – candidate explains a topic</option><option value="meeting">Joining / interview meeting</option></select>
          <label style={{display:"block",marginTop:10}}>Title</label><input value={d.title} onChange={e=>update(r.application_id,{title:e.target.value})} placeholder={d.kind==="meeting"?"Final discussion meeting":"Explain a project or technical topic"}/>
          {d.kind==="video_assignment"?<><label style={{display:"block",marginTop:10}}>Instructions / topic</label><textarea rows={3} value={d.instructions} onChange={e=>update(r.application_id,{instructions:e.target.value})} placeholder="Record a 3–5 minute video explaining..."/><label style={{display:"block",marginTop:10}}>Submission deadline (optional)</label><input type="datetime-local" value={d.due_at} onChange={e=>update(r.application_id,{due_at:e.target.value})}/></>:<><label style={{display:"block",marginTop:10}}>Meeting date and time</label><input type="datetime-local" value={d.meeting_at} onChange={e=>update(r.application_id,{meeting_at:e.target.value})}/><label style={{display:"block",marginTop:10}}>Optional external meeting link (Google Meet / Zoom)</label><input type="url" value={d.meeting_url} onChange={e=>update(r.application_id,{meeting_url:e.target.value})} placeholder="Optional — LiveKit is the default"/></>}
          <button style={{marginTop:12}} disabled={busy===r.application_id||!d.title.trim()||(d.kind==="video_assignment"&&!d.instructions.trim())||(d.kind==="meeting"&&!d.meeting_at)} onClick={()=>submit(r.application_id)}>{busy===r.application_id?"Saving...":d.kind==="meeting"?"Schedule meeting":"Send video assignment"}</button>
        </div>
      </article>})}</div>}
  </div>;
}

function LiveInterview() {
  const {id}=useParams();
  const [session,setSession]=useState(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;call(`/meetings/${id}/token`).then(data=>{if(active)setSession(data);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[id]);
  if(loading)return <div className="wrap"><div className="glass card">Preparing your secure LiveKit interview...</div></div>;
  if(error)return <div className="wrap"><div className="glass card"><h2>Unable to join interview</h2><p className="muted">{error}</p><Link to="/candidate/video-assessment">Back to Video Assessment</Link></div></div>;
  return <div className="live-interview-page">
    <div className="live-interview-heading"><div><h2>{session.meeting_title||"Live interview"}</h2><p className="muted">Matchly · Secure LiveKit interview</p></div><Link to="/" className="ghost">Leave page</Link></div>
    <div className="livekit-shell" data-lk-theme="default"><LiveKitRoom token={session.token} serverUrl={session.server_url} connect={true} video={true} audio={true} onError={e=>setError(e.message)} onDisconnected={()=>{}}><VideoConference/></LiveKitRoom></div>
  </div>;
}

const TestChip = ({t}) => t.status==="completed" ? <span className={"tag "+(t.passed?"ok":"no")}>{t.passed?"Passed":"Not passed"}: {t.score}/{t.total}</span> :
  t.status==="flagged_for_review" ? <span className="tag no">Awaiting recruiter review</span> :
  t.status==="expired" ? <span className="tag no">Test link expired</span> :
  <Link to={"/test/"+t.token}><button className="small" style={{marginTop:8}}>{t.status==="started"?"Continue test":"Take test"}</button></Link>;
const TestScore = ({t}) => !t ? <span className="muted">None</span> : t.status==="completed" ? <b style={{color:t.passed?"#1f9d6b":"#d6457b"}}>{t.score}/{t.total}</b> : <span className="muted">{t.status==="flagged_for_review"?"Review required":t.status}</span>;

function FileDropzone({ file, onFile, disabled = false, accept = ".csv,.xlsx", extensions = ["csv", "xlsx"], title = "Upload your MCQ questions", description = "Drag and drop your CSV or Excel file here", formats = "CSV and XLSX" }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const choose = selected => {
    if (!selected) return;
    const ext = selected.name.split(".").pop().toLowerCase();
    if (!extensions.includes(ext)) {
      window.alert(`Please select a supported file: ${formats}.`);
      return;
    }
    onFile(selected);
  };

  return <div
    onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled) choose(e.dataTransfer.files[0]); }}
    onClick={() => !disabled && inputRef.current?.click()}
    role="button"
    tabIndex={disabled ? -1 : 0}
    onKeyDown={e => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); inputRef.current?.click(); } }}
    aria-label={`Choose or drop a file: ${formats}`}
    style={{
      border: `2px dashed ${dragging ? "#704cff" : "#b58af5"}`,
      borderRadius: 20,
      padding: "30px 20px",
      textAlign: "center",
      cursor: disabled ? "not-allowed" : "pointer",
      background: dragging ? "rgba(130,90,255,.16)" : "rgba(255,255,255,.65)",
      transition: "all .2s ease",
      color: "#35234f",
      opacity: disabled ? .65 : 1,
      outline: "none"
    }}
  >
    <input ref={inputRef} type="file" accept={accept} hidden disabled={disabled}
      onChange={e => { choose(e.target.files?.[0]); e.target.value = ""; }} />
    <div style={{fontSize:38,marginBottom:10}}>☁️</div>
    <h3 style={{margin:"0 0 8px",color:"#35234f"}}>{dragging ? "Drop your file here!" : title}</h3>
    <p style={{color:"#756487",margin:"0 0 16px"}}>{description}</p>
    <span style={{display:"inline-block",padding:"10px 22px",borderRadius:12,color:"white",background:"linear-gradient(120deg,#a855f7,#6955ff)",fontWeight:700}}>Browse files</span>
    <p style={{color:"#88799a",fontSize:12,marginTop:14}}>Supported formats: {formats}</p>
    {file && <div onClick={e=>e.stopPropagation()} style={{marginTop:16,padding:12,background:"#eee5ff",borderRadius:12,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,overflowWrap:"anywhere"}}>
      <span>📄 {file.name}</span>
      <button type="button" disabled={disabled} onClick={e=>{e.stopPropagation();onFile(null);}}>Remove</button>
    </div>}
  </div>;
}

function RecruiterQuestionStudio() {
  const [jobs,setJobs]=useState([]);
  const [jobId,setJobId]=useState("");
  const [info,setInfo]=useState(null);
  const [file,setFile]=useState(null);
  const [editing,setEditing]=useState(null);
  const [busy,setBusy]=useState(false);
  const [n,ok,err]=useNote();
  const loadJobs=()=>call("/recruiter/jobs").then(rows=>{
    setJobs(rows);
    if(!jobId && rows.length) setJobId(String(rows[0].id));
  }).catch(err);
  const loadQuestions=(id=jobId)=>{
    if(!id){setInfo(null);return;}
    call(`/jobs/${id}/questions`).then(setInfo).catch(err);
  };
  useEffect(()=>{loadJobs();},[]);
  useEffect(()=>{if(jobId) loadQuestions(jobId);},[jobId]);
  const upload=async()=>{
    if(!file||!jobId){ok("Choose a job and a CSV/XLSX file first.","err");return;}
    setBusy(true);
    try{
      const fd=new FormData();fd.append("f",file);
      const r=await call(`/jobs/${jobId}/questions/import`,{method:"POST",form:fd});
      ok(`Added ${r.added} questions. This job now has ${r.count}/50 valid questions.${r.skipped?` ${r.skipped} invalid rows were skipped.`:""}`);
      setFile(null);loadQuestions(jobId);loadJobs();
    }catch(e){err(e);}finally{setBusy(false);}
  };
  const save=async()=>{
    if(!editing)return;
    setBusy(true);
    try{
      await call(`/jobs/${jobId}/questions/${editing.id}`,{method:"PUT",body:editing});
      ok("Question updated successfully.");setEditing(null);loadQuestions(jobId);
    }catch(e){err(e);}finally{setBusy(false);}
  };
  const publish=async()=>{
    if(!info?.ready){ok(`Add ${Math.max(0,50-(info?.count||0))} more valid questions before publishing.`,"err");return;}
    setBusy(true);
    try{await call(`/jobs/${jobId}/status`,{method:"PUT",body:{status:"published"}});ok("Job published successfully.");loadJobs();}
    catch(e){err(e);}finally{setBusy(false);}
  };
  const selected=jobs.find(x=>String(x.id)===String(jobId));
  return <div className="wrap">
    <h2>Recruitment Question Studio</h2>
    <p className="muted" style={{maxWidth:850,lineHeight:1.6}}>Create and maintain the MCQ assessment for each vacancy. Every job has its own question set. You can add questions to draft or published jobs, and edit existing questions here.</p>
    <Note n={n}/>
    <section className="glass card" style={{marginBottom:16}}>
      <h3 style={{marginTop:0}}>Choose a job</h3>
      {!jobs.length?<p className="muted">No jobs found. Create a job first in Jobs and applicants.</p>:
        <select aria-label="Select job to manage questions" value={jobId} onChange={e=>{setJobId(e.target.value);setEditing(null);}} style={{width:"100%",maxWidth:650,padding:13,fontSize:"1rem"}}>
          {jobs.map(x=><option key={x.id} value={x.id}>{x.title} · {x.status}</option>)}
        </select>}
      {selected&&<p className="muted" style={{marginBottom:0}}>Selected: <b>{selected.title}</b> · {selected.location} · Status: {selected.status}</p>}
    </section>
    {jobId&&<>
      <section className="glass card" style={{marginBottom:16,background:"rgba(255,255,255,.78)",color:"#24153f"}}>
        <div className="row" style={{alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
          <div><h3 style={{margin:"0 0 5px",color:"#24153f"}}>Question set overview</h3><p style={{margin:0,color:"#514568"}}>Minimum required to publish: 50 valid MCQs</p></div>
          <div style={{fontSize:"1.5rem",fontWeight:800,color:"#6d4aff"}}>{info?`${info.count}/50`:"Loading…"}</div>
        </div>
        <div style={{height:10,background:"#e8ddf7",borderRadius:20,overflow:"hidden",margin:"14px 0"}}><div style={{height:"100%",width:`${Math.min(100,(info?.count||0)/50*100)}%`,background:"linear-gradient(90deg,#a855f7,#6755ff)",borderRadius:20}}/></div>
        <p style={{color:"#514568",lineHeight:1.5}}>{info?.ready?"This job has enough questions to be published.":`Add ${Math.max(0,50-(info?.count||0))} more valid question(s) before publishing.`}</p>
        {selected?.status!=="published"&&<button disabled={busy||!info?.ready} onClick={publish}>Publish this job</button>}
      </section>
      <section className="glass card" style={{marginBottom:16,background:"rgba(255,255,255,.78)",color:"#24153f"}}>
        <h3 style={{marginTop:0,color:"#24153f"}}>Upload questions</h3>
        <p style={{color:"#514568",lineHeight:1.55}}>Use the SkillSphere CSV/XLSX template. Required columns: <b>technology, question, option_a, option_b, option_c, option_d, answer</b>. Answer must be A, B, C, or D. Uploading adds valid rows to this job's set.</p>
        <div style={{display:"grid",gap:14}}><FileDropzone file={file} onFile={setFile} disabled={busy}/><div><button disabled={busy||!file} onClick={upload}>{busy?"Uploading…":"Upload questions"}</button></div></div>
      </section>
      <section className="glass card" style={{background:"rgba(255,255,255,.78)",color:"#24153f"}}>
        <div className="row" style={{alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}><h3 style={{marginTop:0,color:"#24153f"}}>Review and edit questions</h3><button className="ghost" onClick={()=>loadQuestions(jobId)}>Refresh list</button></div>
        {!info?<p style={{color:"#514568"}}>Loading questions…</p>:!info.items?.length?<p style={{color:"#514568"}}>No questions uploaded for this job yet.</p>:
          <div style={{display:"grid",gap:12}}>{info.items.map((q,index)=><article key={q.id} style={{background:"#fff",border:"1px solid #dfd2f2",borderRadius:14,padding:16,color:"#24153f"}}>
            {editing?.id===q.id?<>
              <label style={{display:"block",fontWeight:700,marginBottom:6}}>Question {index+1}</label>
              <input value={editing.text} onChange={e=>setEditing({...editing,text:e.target.value})} style={{width:"100%",marginBottom:10,color:"#24153f",background:"#fff"}}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>{["a","b","c","d"].map(k=><label key={k} style={{color:"#493b62"}}>Option {k.toUpperCase()}<input value={editing[k]} onChange={e=>setEditing({...editing,[k]:e.target.value})} style={{width:"100%",color:"#24153f",background:"#fff"}}/></label>)}</div>
              <label style={{display:"block",marginTop:10,color:"#493b62"}}>Correct answer<select value={editing.answer} onChange={e=>setEditing({...editing,answer:e.target.value})} style={{display:"block",padding:9,marginTop:5}}>{["A","B","C","D"].map(k=><option key={k}>{k}</option>)}</select></label>
              <div className="row" style={{marginTop:12}}><button disabled={busy} onClick={save}>Save changes</button><button className="ghost" onClick={()=>setEditing(null)}>Cancel</button></div>
            </>:<>
              <div className="row" style={{alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}><b style={{fontSize:"1rem",lineHeight:1.5}}>Q{index+1}. {q.text}</b><button className="ghost" onClick={()=>setEditing({...q})}>Edit question</button></div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:7,marginTop:10}}>{[["A",q.a],["B",q.b],["C",q.c],["D",q.d]].map(([k,v])=><div key={k} style={{padding:"8px 10px",borderRadius:9,background:q.answer===k?"#e8f8ee":"#f4effb",color:"#35234f",lineHeight:1.4}}><b>{k}.</b> {v}</div>)}</div>
              <div style={{marginTop:9,fontSize:".9rem",color:"#4c3c64"}}>Technology: {q.tech} · Correct answer: <b>{q.answer}</b></div>
            </>}
          </article>)}</div>}
      </section>
    </>}
  </div>;
}

function QBank() {
  const [d,setD]=useState(); const [n,ok,err]=useNote(); const [busy,setBusy]=useState(false); const [file,setFile]=useState(null);
  const load=()=>call("/questions/stats").then(setD).catch(err); useEffect(()=>{ load(); },[]);
  const up=async()=>{ if(!file){err("Choose a CSV or XLSX file first.");return;} const fd=new FormData(); fd.append("f",file); setBusy(true);
    try { const r=await call("/questions/import",{method:"POST",form:fd}); ok(`Added ${r.added} questions${r.skipped?`, skipped ${r.skipped} rows with missing data`:""}.`); setFile(null); load(); }
    catch(e){err(e);} finally{setBusy(false);} };
  return <div className="wrap"><h2>Question bank</h2><Note n={n}/>
    <div className="glass card"><h3>Import questions</h3><p className="muted">Upload a .csv or .xlsx file with these columns: technology, question, option A, option B, option C, option D, answer (A, B, C or D). The first row is the header. Your company's questions are used first when a candidate is tested.</p>
      <div style={{display:"grid",gap:14}}><FileDropzone file={file} onFile={setFile} disabled={busy}/><div><button onClick={up} disabled={busy||!file}>{busy?"Uploading…":"Upload questions"}</button></div></div></div>
    <div className="glass card"><h3>Questions per technology</h3>{!d?<p className="muted">Loading...</p>:!d.items.length?<p className="muted">No questions yet. Import a file above.</p>:
      <table><thead><tr><th>Technology</th><th>Your company</th><th>Shared</th><th>Ready for {d.test_size} questions</th></tr></thead><tbody>{d.items.map(x=><tr key={x.tech}><td>{x.tech}</td><td>{x.mine}</td><td>{x.shared}</td>
        <td>{x.mine+x.shared>=d.test_size?<span className="tag ok">Yes</span>:<span className="tag no">Needs {d.test_size-x.mine-x.shared} more</span>}</td></tr>)}</tbody></table>}</div></div>;
}

function TestPage() {
  const {token}=useParams();
  const [info,setInfo]=useState();
  const [q,setQ]=useState(null);
  const [ans,setAns]=useState({});
  const [i,setI]=useState(0);
  const [left,setLeft]=useState(0);
  const [res,setRes]=useState();
  const [n,ok,err]=useNote();
  const [busy,setBusy]=useState(false);
  const [sessionId,setSessionId]=useState(null);
  const [cameraStream,setCameraStream]=useState(null);
  const [cameraError,setCameraError]=useState("");
  const [recordingState,setRecordingState]=useState("waiting");
  const recorderRef=useRef(null);
  const recordingChunksRef=useRef([]);
  const [consent,setConsent]=useState(false);
  const [warningCount,setWarningCount]=useState(0);
  const [warningMessage,setWarningMessage]=useState("");
  const [terminated,setTerminated]=useState(false);
  const fullscreenWasActive=useRef(false);
  const sessionRef=useRef(null);
  const videoRef=useRef(null);
  const terminatedRef=useRef(false);
  const eventQueueRef=useRef(Promise.resolve());
  const lastEventRef=useRef({});

  useEffect(()=>{ call("/tests/"+token).then(setInfo).catch(err); },[token]);

  const recordEvent=useCallback((event_type,description)=>{
    const id=sessionRef.current;
    if(!id || terminatedRef.current) return;

    // Avoid duplicate browser events fired back-to-back for the same action.
    const now=Date.now();
    if(lastEventRef.current[event_type] && now-lastEventRef.current[event_type]<900) return;
    lastEventRef.current[event_type]=now;

    // Process events in order so rapid tab switches cannot race the warning counter.
    eventQueueRef.current=eventQueueRef.current.then(async()=>{
      if(terminatedRef.current) return;
      try {
        const result=await call(`/tests/${token}/proctoring/events`,{
          method:"POST",
          body:{session_id:id,event_type,description}
        });
        const count=Number(result.warning_count || 0);
        const remaining=Math.max(0,Number(result.warning_limit || 3)-count);
        const labels={
          tab_switch:"You switched away from the exam tab.",
          fullscreen_exit:"You exited fullscreen mode.",
          face_not_detected:description?.includes("turn their head") ? "You appeared to turn your head away from the screen for too long." : "Your face was not visible to the camera.",
          multiple_faces:"More than one face was detected.",
          camera_disabled:"Your camera was disconnected or disabled.",
          phone_detected:"A possible phone-use event was detected."
        };
        setWarningCount(count);
        setWarningMessage(result.terminated
          ? `Warning ${count}/3 — ${labels[event_type] || description || "A monitoring rule was triggered."} Your test has been stopped and sent to the recruiter for review.`
          : `Warning ${count}/3 — ${labels[event_type] || description || "A monitoring rule was triggered."} ${remaining} ${remaining===1?"warning":"warnings"} remaining before the test is stopped.`);
        if(result.terminated){
          terminatedRef.current=true;
          setTerminated(true);
          setInfo(current=>current?{...current,status:"flagged_for_review"}:current);
          setQ(null);
          setCameraStream(stream=>{if(stream)stream.getTracks().forEach(track=>track.stop());return null;});
        }
      } catch(e) {
        console.warn("Could not record proctoring event:",e.message);
        setWarningMessage("A monitoring event could not be saved. Please check your connection and contact the recruiter if this continues.");
      }
    });
  },[token]);

  const stopCamera=useCallback(()=>{
    setCameraStream(stream=>{
      if(stream) stream.getTracks().forEach(track=>track.stop());
      return null;
    });
  },[]);

  const submit=a=>{
    setBusy(true);
    call(`/tests/${token}/submit`,{method:"POST",body:{answers:a}})
      .then(r=>{ setRes(r); setQ(null); })
      .catch(e=>{ err(e); setQ(null); })
      .finally(()=>{ setBusy(false); stopCamera(); });
  };

  const start=async()=>{
    if(!consent) { err(new Error("Please confirm that you understand the camera and exam monitoring notice.")); return; }
    try {
      const r=await call("/tests/"+token+"/start",{method:"POST"});
      sessionRef.current=r.proctoring_session_id;
      setSessionId(r.proctoring_session_id);
      setWarningCount(Number(r.warning_count || 0));
      setWarningMessage("");
      terminatedRef.current=false;
      lastEventRef.current={};
      eventQueueRef.current=Promise.resolve();
      setTerminated(false);
      setQ(r.questions);
      setLeft(r.seconds);
      setAns({});
      setI(0);
      setCameraError("");
    } catch(e) { err(e); }
  };

  useEffect(()=>{
    if(!q || !sessionId) return;
    let active=true;
    const onVisibility=()=>{
      if(document.visibilityState==="hidden") recordEvent("tab_switch","Candidate switched away from the exam tab.");
    };
    const onFullscreen=()=>{
      if(document.fullscreenElement) fullscreenWasActive.current=true;
      else if(fullscreenWasActive.current) {
        fullscreenWasActive.current=false;
        recordEvent("fullscreen_exit","Candidate exited fullscreen mode.");
      }
    };
    document.addEventListener("visibilitychange",onVisibility);
    document.addEventListener("fullscreenchange",onFullscreen);

    const enableCamera=async()=>{
      try {
        if(!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported by this browser.");
        const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
        if(!active) { stream.getTracks().forEach(track=>track.stop()); return; }
        setCameraStream(stream);
        const videoTrack=stream.getVideoTracks()[0];
        if(videoTrack) videoTrack.addEventListener("ended",()=>{
          setCameraError("Camera disconnected. Reconnect it to continue.");
          recordEvent("camera_disabled","The camera video track ended.");
        });
      } catch(e) {
        if(!active) return;
        setCameraError(e.message || "Camera permission was denied.");
        recordEvent("camera_disabled","Camera access was unavailable: "+(e.message || "permission denied"));
      }
    };
    enableCamera();

    return ()=>{
      active=false;
      document.removeEventListener("visibilitychange",onVisibility);
      document.removeEventListener("fullscreenchange",onFullscreen);
    };
  },[q,sessionId,recordEvent]);

  useEffect(()=>{
    if(videoRef.current && cameraStream) videoRef.current.srcObject=cameraStream;
  },[cameraStream]);

  // Record the same webcam stream used by proctoring. Upload only after the test ends.
  useEffect(()=>{
    if(!cameraStream || !q) return;
    if(!window.MediaRecorder) { setRecordingState("unsupported"); return; }
    let recorder;
    try {
      const mimeType=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"]
        .find(type=>MediaRecorder.isTypeSupported(type));
      recorder=new MediaRecorder(cameraStream,mimeType?{mimeType}:undefined);
      recordingChunksRef.current=[];
      recorder.ondataavailable=e=>{if(e.data && e.data.size) recordingChunksRef.current.push(e.data);};
      recorder.onstart=()=>setRecordingState("recording");
      recorder.onerror=()=>setRecordingState("failed");
      recorder.onstop=async()=>{
        const blob=new Blob(recordingChunksRef.current,{type:recorder.mimeType||"video/webm"});
        recordingChunksRef.current=[];
        if(!blob.size){setRecordingState("failed");return;}
        setRecordingState("uploading");
        try{
          const fd=new FormData();
          fd.append("video",blob,`matchly-test-${token}.webm`);
          await call(`/tests/${token}/recording`,{method:"POST",form:fd});
          setRecordingState("saved");
        }catch(e){console.error("Test recording upload failed:",e);setRecordingState("failed");}
      };
      recorderRef.current=recorder;
      recorder.start(1000);
    }catch(e){console.error("Could not start test recording:",e);setRecordingState("failed");}
    return ()=>{
      if(recorder && recorder.state!=="inactive") recorder.stop();
      if(recorderRef.current===recorder) recorderRef.current=null;
    };
  },[cameraStream,q,token]);

  // Face monitoring: SSD MobileNet is more reliable than the tiny detector when a second
  // person enters the camera frame. Detection runs independently of the head-direction check.
  useEffect(()=>{
    if(!q || !cameraStream) return;
    let cancelled=false, timer=null, scanBusy=false;
    let missingFrames=0, multipleFrames=0, awayFrames=0;
    let missingReported=false, multipleReported=false, awayReported=false;
    const loadFaceApi=()=>new Promise((resolve,reject)=>{
      if(window.faceapi) return resolve(window.faceapi);
      const existing=document.querySelector('script[data-face-api]');
      if(existing){
        if(window.faceapi) return resolve(window.faceapi);
        existing.addEventListener('load',()=>resolve(window.faceapi),{once:true});
        existing.addEventListener('error',()=>reject(new Error('Face detection library failed to load.')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
      script.async=true; script.dataset.faceApi='1';
      script.onload=()=>window.faceapi?resolve(window.faceapi):reject(new Error('Face detection library did not load.'));
      script.onerror=()=>reject(new Error('Could not load face detection library. Check your internet connection.'));
      document.head.appendChild(script);
    });
    const monitor=async()=>{
      try{
        const api=await loadFaceApi();
        const modelUrl='https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await Promise.all([
          api.nets.ssdMobilenetv1.loadFromUri(modelUrl),
          api.nets.faceLandmark68Net.loadFromUri(modelUrl)
        ]);
        if(cancelled) return;
        const video=videoRef.current;
        if(!video) throw new Error('Camera video element is unavailable.');
        // Wait for actual camera dimensions before starting inference.
        if(video.readyState<2 || !video.videoWidth || !video.videoHeight){
          await new Promise(resolve=>{
            const ready=()=>{video.removeEventListener('loadeddata',ready);resolve();};
            video.addEventListener('loadeddata',ready,{once:true});
            setTimeout(()=>{video.removeEventListener('loadeddata',ready);resolve();},5000);
          });
        }
        if(cancelled) return;
        timer=setInterval(async()=>{
          if(cancelled || scanBusy || terminatedRef.current || video.readyState<2 || !video.videoWidth || video.paused) return;
          scanBusy=true;
          try{
            const detections=await api.detectAllFaces(video,new api.SsdMobilenetv1Options({minConfidence:0.35,maxResults:20}));
            if(cancelled) return;
            // Count every face first; landmarks are only needed for the single-person direction estimate.
            if(detections.length>1){
              multipleFrames++; missingFrames=0; awayFrames=0;
              missingReported=false; awayReported=false;
              if(multipleFrames>=2 && !multipleReported){
                multipleReported=true;
                recordEvent('multiple_faces','More than one person was detected in the camera frame.');
              }
              return;
            }
            multipleFrames=0; multipleReported=false;
            if(detections.length===0){
              missingFrames++; awayFrames=0;
              awayReported=false;
              if(missingFrames>=4 && !missingReported){
                missingReported=true;
                recordEvent('face_not_detected','Candidate face was not visible in the camera for several consecutive checks.');
              }
              return;
            }
            missingFrames=0; missingReported=false;
            try{
              const withLandmarks=await api.detectAllFaces(video,new api.SsdMobilenetv1Options({minConfidence:0.35,maxResults:1})).withFaceLandmarks();
              if(!withLandmarks.length) return;
              const pts=withLandmarks[0].landmarks.positions;
              const leftEye=pts.slice(36,42), rightEye=pts.slice(42,48), nose=pts[30];
              const eyeCenter=(leftEye.reduce((a,p)=>a+p.x,0)/6 + rightEye.reduce((a,p)=>a+p.x,0)/6)/2;
              const eyeSpan=Math.abs(rightEye.reduce((a,p)=>a+p.x,0)/6-leftEye.reduce((a,p)=>a+p.x,0)/6);
              const ratio=eyeSpan ? (nose.x-eyeCenter)/eyeSpan : 0.5;
              const lookingSideways=ratio<0.25 || ratio>0.75;
              if(lookingSideways){
                awayFrames++;
                if(awayFrames>=6 && !awayReported){
                  awayReported=true;
                  recordEvent('face_not_detected','Candidate appeared to turn their head away from the screen for a sustained period.');
                }
              }else{ awayFrames=0; awayReported=false; }
            }catch(landmarkError){ console.warn('Head direction check failed:',landmarkError); }
          }catch(e){ console.warn('Face monitoring frame failed:',e); }
          finally{ scanBusy=false; }
        },650);
      }catch(e){
        console.warn('Face monitoring could not start:',e.message);
        if(!cancelled) setCameraError('Camera preview is active, but automatic face monitoring could not load: '+e.message);
      }
    };
    monitor();
    return ()=>{ cancelled=true; if(timer) clearInterval(timer); };
  },[q,cameraStream,recordEvent]);

  useEffect(()=>{ if(!q) stopCamera(); },[q,stopCamera]);
  useEffect(()=>{ if(!q) return; const t=setInterval(()=>setLeft(x=>x-1),1000); return ()=>clearInterval(t); },[q]);
  useEffect(()=>{ if(q&&left<=0) submit(ans); },[left]);
  const enterFullscreen=async()=>{
    try {
      if(!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } catch(e) { err(new Error("Fullscreen could not be enabled: "+e.message)); }
  };
  const box={maxWidth:760,margin:"0 auto"};
  useEffect(()=>{ if(res?.passed) confetti(); },[res]);

  if(res) return <div className="wrap" style={box}><div className="glass card" style={{textAlign:"center"}}><h2>{res.passed?"You passed!":"Test submitted"}</h2><Donut pct={res.percent} label="Score"/>
    <p style={{fontSize:"1.1rem"}}>{res.message}</p>
    <div className="grid4" style={{margin:"14px 0"}}>{[["Correct",res.correct],["Wrong",res.wrong],["Unanswered",res.unanswered],["Passing mark",res.pass_mark+"/"+res.total]].map(([l,v])=><div key={l} className="glass card" style={{margin:0}}><div className="stat" style={{fontSize:"1.6rem"}}>{v}</div><div className="muted">{l}</div></div>)}</div>
    <Link to="/applications"><button className="small">View my applications</button></Link></div></div>;

  if(q) {
    const cur=q[i], mm=String(Math.floor(Math.max(0,left)/60)).padStart(2,"0")+":"+String(Math.max(0,left)%60).padStart(2,"0");
    return <div className="wrap" style={box}><style>{`
.proctor-warning-backdrop{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:20px;background:rgba(8,3,18,.78);backdrop-filter:blur(12px);animation:proctorFade .18s ease-out}
.proctor-warning-popup{width:min(460px,100%);padding:30px 28px 24px;text-align:center;border:1px solid rgba(255,70,90,.75);border-radius:22px;background:linear-gradient(145deg,#24101d,#100d1b 72%);color:#fff;box-shadow:0 0 0 1px rgba(255,50,70,.15),0 0 55px rgba(255,25,65,.35);animation:proctorPop .35s cubic-bezier(.2,.9,.2,1.2),proctorShake .42s ease .35s}
.proctor-warning-icon{width:62px;height:62px;margin:0 auto 14px;border-radius:50%;display:grid;place-items:center;font-size:42px;font-weight:900;color:#fff;background:#e32645;box-shadow:0 0 0 9px rgba(227,38,69,.14),0 0 32px rgba(255,30,70,.7)}
.proctor-warning-kicker{font-size:11px;letter-spacing:3px;font-weight:900;color:#ff8797}
.proctor-warning-popup h2{margin:8px 0 10px;font-size:28px;letter-spacing:1px;color:#fff}
.proctor-warning-popup p{color:#f4dfe5;line-height:1.55;margin:0 0 18px}
.proctor-warning-progress{height:9px;border-radius:20px;overflow:hidden;background:#4b2734;margin:18px 0 9px}
.proctor-warning-progress i{display:block;height:100%;border-radius:20px;background:linear-gradient(90deg,#ff9a55,#ff315c);transition:width .35s ease}
.proctor-warning-popup small{color:#ffc2cc}
.proctor-warning-dismiss{display:block;width:100%;margin-top:20px;padding:13px;border:0;border-radius:10px;background:#ed3151;color:white;font-weight:900;letter-spacing:.5px;cursor:pointer}
.proctor-warning-dismiss:hover{background:#ff4968;transform:translateY(-1px)}
@keyframes proctorFade{from{opacity:0}to{opacity:1}}
@keyframes proctorPop{from{opacity:0;transform:scale(.78) translateY(18px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes proctorShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}
`}</style><Note n={n}/>
      {warningMessage&&!terminated&&<div className="proctor-warning-backdrop" role="alertdialog" aria-modal="true" aria-live="assertive">
        <div className="proctor-warning-popup"><div className="proctor-warning-icon">!</div><div className="proctor-warning-kicker">EXAM INTEGRITY ALERT</div><h2>WARNING {warningCount} OF 3</h2><p>{warningMessage.replace(/^Warning \d+\/3 — /,'').replace(/ \d+ warnings? remaining before the test is stopped\.?$/,'')}</p><div className="proctor-warning-progress"><i style={{width:(warningCount/3*100)+'%'}}/></div><small>{Math.max(0,3-warningCount)} warning(s) remaining before the test is stopped.</small><button className="proctor-warning-dismiss" onClick={()=>setWarningMessage('')}>I UNDERSTAND — RETURN TO TEST</button></div>
      </div>}
      {warningMessage&&<div className={"note "+(terminated?"err":"")} role="alert" aria-live="assertive">{warningMessage}</div>}
      <div className="glass card" style={{marginBottom:12}}>
        <div className="row" style={{alignItems:"center",justifyContent:"space-between"}}>
          <b>Online exam monitoring</b>
          <span className={"tag "+(warningCount>0?"no":"")}>Warnings: {warningCount}/3</span>
          <span className={"tag "+(cameraStream?"ok":"no")}>{cameraStream?"Camera connected":"Camera unavailable"}</span>
        </div>
        <div className="row" style={{alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera preview" style={{width:150,height:112,objectFit:"cover",borderRadius:12,background:"#171322"}}/>
          <div style={{flex:1,minWidth:200}}>
            <p className="muted" style={{marginTop:0}}>Keep your face visible and stay on this exam tab. Tab changes, fullscreen exits and camera interruptions are recorded. Three recorded warnings stop the test and send it to the recruiter for review.</p>
            {cameraError&&<p className="muted" role="alert">{cameraError}</p>}
            <button className="ghost small" onClick={enterFullscreen}>Enter fullscreen</button>
          </div>
        </div>
      </div>
      <div className="glass card"><div className="row" style={{alignItems:"center"}}><div className="muted">Question {i+1} of {q.length} · {info?.job}</div><div className={"timer"+(left<120?" low":"")} style={{textAlign:"right"}} role="timer">{mm}</div></div>
        <div className="meter"><b style={{width:((i+1)/q.length*100)+"%"}}/></div>
        <h3 style={{margin:"16px 0 8px"}}>{cur.text}</h3>
        {Object.entries(cur.options).filter(([,v])=>v).map(([k,v])=><label key={k} className={"opt"+(ans[cur.id]===k?" on":"")}><input type="radio" name={"q"+cur.id} checked={ans[cur.id]===k} onChange={()=>setAns({...ans,[cur.id]:k})}/><b>{k}</b> {v}</label>)}
        <div className="qdots">{q.map((x,k)=><button key={x.id} className={(ans[x.id]?"done ":"")+(k===i?"cur":"")} onClick={()=>setI(k)} aria-label={"Go to question "+(k+1)}>{k+1}</button>)}</div>
        <div className="row" style={{justifyContent:"space-between"}}><button className="ghost small" disabled={i===0} onClick={()=>setI(i-1)}>Previous</button>
          {i<q.length-1 ? <button className="small" onClick={()=>setI(i+1)}>Next</button> : <button className="small" disabled={busy} onClick={()=>{ const un=q.length-Object.keys(ans).length; if(window.confirm(un?`${un} question(s) are unanswered. Submit anyway?`:"Submit your test?")) submit(ans); }}>Submit test</button>}</div></div></div>;
  }

  return <div className="wrap" style={box}><Note n={n}/>{warningMessage&&<div className="note err" role="alert" aria-live="assertive">{warningMessage}</div>}{!info ? <div className="glass card skel"/> : <div className="glass card">
    <h2>Skills test</h2><p className="muted">{info.job} at {info.company}</p>
    <p>{info.total} multiple choice questions · {info.minutes} minutes · based on your skills: {info.tech} · passing mark {info.pass_mark}/{info.total}</p>
    {info.status==="flagged_for_review" ? <div className="note err" role="status">This attempt was stopped after three monitoring warnings. The recruiter will review the recorded events and decide whether to allow another attempt.</div> :
      info.status==="completed" ? <p>You already completed this test and scored <b>{info.score}/{info.total}</b>. {info.score>=info.pass_mark?"You passed and were selected for the next round.":"The passing mark was "+info.pass_mark+"."}</p> : info.status==="expired" ? <p>This test link has expired. Please contact the recruiter.</p> :
      <><p className="muted">Complete the test yourself. You can take it once. The timer starts when you press Start and keeps running if you close the page.</p>
      <label style={{display:"flex",alignItems:"flex-start",gap:9,margin:"14px 0"}}>
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{width:"auto",marginTop:4}}/>
        <span className="muted">I understand that my camera preview is used during this exam and that tab switching, fullscreen exits and camera interruptions may be recorded for recruiter review. Three warnings will stop the test.</span>
      </label>
      <button onClick={start} disabled={!consent}>{info.status==="started"?"Continue test":"Start test"}</button></>}
    <p><Link to="/applications">Back to applications</Link></p></div>}</div>;
}

function AnimatedRoutes() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const isTestPage = location.pathname.startsWith("/test/");

  return <AnimatePresence mode="wait" initial={false}>
    <motion.div
      key={location.pathname + location.search}
      initial={reduceMotion || isTestPage ? false : {opacity:0,y:18,filter:"blur(5px)"}}
      animate={{opacity:1,y:0,filter:"blur(0px)"}}
      exit={reduceMotion || isTestPage ? {opacity:1} : {opacity:0,y:-10,filter:"blur(3px)"}}
      transition={{duration:reduceMotion?0:.42,ease:[.22,1,.36,1]}}
      style={{width:"100%",minWidth:0}}
    >
      <Routes location={location}>
    <Route path="/" element={<Landing/>}/><Route path="/login" element={<Auth mode="login"/>}/><Route path="/register" element={<Auth mode="register"/>}/>
    <Route path="/jobs" element={<JobsKey/>}/>
    <Route path="/resume" element={<Guard role="candidate"><Resume/></Guard>}/>
    <Route path="/applications" element={<Guard role="candidate"><Applications/></Guard>}/>
    <Route path="/recruiter" element={<Guard role="recruiter"><Recruiter/></Guard>}/>
    <Route path="/admin" element={<Guard role="admin"><Admin/></Guard>}/>
    <Route path="/dashboard" element={<Guard role="candidate"><Dashboard/></Guard>}/>
    <Route path="/saved" element={<Guard role="candidate"><Saved/></Guard>}/>
    <Route path="/profile" element={<Guard role="candidate"><Profile/></Guard>}/>
    <Route path="/recruiter/dashboard" element={<Guard role="recruiter"><RDash/></Guard>}/>
    <Route path="/recruiter/questions" element={<Guard role="recruiter"><RecruiterQuestionStudio/></Guard>}/>
    <Route path="/recruiter/pipeline" element={<Guard role="recruiter"><Pipeline/></Guard>}/>
    <Route path="/recruiter/video-assessment" element={<Guard role="recruiter"><VideoAssessment/></Guard>}/>
    <Route path="/candidate/video-assessment" element={<Guard role="candidate"><CandidateVideoAssessment/></Guard>}/>
    <Route path="/meeting/:id" element={<Guard role={["candidate","recruiter"]}><LiveInterview/></Guard>}/>
    <Route path="/test/:token" element={<Guard role="candidate"><TestPage/></Guard>}/>
    <Route path="/questions" element={<Guard role="admin"><QBank/></Guard>}/>
    <Route path="*" element={<Navigate to="/"/>}/>
      </Routes>
    </motion.div>
  </AnimatePresence>;
}

export default function App() {
  return <Provider><BrowserRouter><div className="aurora" aria-hidden="true"><i/><i/><i/></div><Nav/><Shell><AnimatedRoutes/></Shell></BrowserRouter></Provider>;
}
