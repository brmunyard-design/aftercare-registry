import { FormEvent, useEffect, useMemo, useState } from "react";

type Task = {
  id: string; title: string; description: string; category: string; publicStatus?: string;
};
type Registry = { id: string; slug: string; familyName: string; message: string };

const API = "/api";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function Header() {
  return <header className="topbar"><div className="brand"><span className="mark">+</span><span>Aftercare <strong>Registry</strong></span></div><span className="quiet">Practical support, organised gently.</span></header>;
}

function Home() {
  return <main className="shell">
    <section className="hero">
      <div className="eyebrow">A simple support registry for families</div>
      <h1>Let people help.<br/><em>Without the family having to ask.</em></h1>
      <p className="lead">After a funeral or during a difficult period, practical support often exists — but people don't always know what would actually help. Aftercare Registry gives everyone one clear place to offer it.</p>
      <div className="actions">
        <a className="button primary" href="#create">Create a registry</a>
        <a className="button secondary" href="#recover">Recover my commitment</a>
      </div>
    </section>

    <section className="three">
      <article><span>01</span><h3>The family shares one link</h3><p>A private registry can be shared by link or QR code.</p></article>
      <article><span>02</span><h3>People choose how to help</h3><p>Meals, errands, check-ins, garden work and other practical jobs.</p></article>
      <article><span>03</span><h3>Someone can see what is covered</h3><p>A clear status view shows what is covered, offered or still needs help.</p></article>
    </section>

    <CreateRegistry />
    <Recover />
  </main>;
}

function CreateRegistry() {
  const [familyName, setFamilyName] = useState("");
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<{registry: Registry; adminToken: string} | null>(null);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      const result = await api<{registry: Registry; adminToken: string}>("/registries", {
        method: "POST", body: JSON.stringify({ familyName, message })
      });
      setCreated(result);
    } catch (e) { setError((e as Error).message); }
  }

  return <section id="create" className="panel">
    <div className="panel-copy"><div className="eyebrow">Start a registry</div><h2>Create a simple place for people to help.</h2><p>This is the first working version. It creates a private family link, a professional dashboard link and a set of common practical support tasks.</p></div>
    {!created ? <form onSubmit={submit} className="form">
      <label>Family name<input value={familyName} onChange={e=>setFamilyName(e.target.value)} placeholder="The Smith family" required /></label>
      <label>Optional message<textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="A short message from the family..." /></label>
      {error && <div className="error">{error}</div>}
      <button className="button primary">Create registry</button>
    </form> : <div className="success">
      <h3>Registry created.</h3>
      <p>Share this family link with people who want to help:</p>
      <code>{location.origin}/r/{created.registry.slug}</code>
      <p className="small">Professional dashboard:</p>
      <code>{location.origin}/admin?slug={created.registry.slug}&token={created.adminToken}</code>
      <a className="button secondary" href={`/r/${created.registry.slug}`}>Open family registry</a>
    </div>}
  </section>;
}

function Registry({ slug }: {slug: string}) {
  const [data, setData] = useState<{registry: Registry; tasks: Task[]}>();
  const [selected, setSelected] = useState<Task>();
  const [message, setMessage] = useState("");

  useEffect(()=>{ api<{registry: Registry; tasks: Task[]}>(`/registries/${slug}`).then(setData).catch(e=>setMessage(e.message)); },[slug]);

  if (message) return <main className="shell"><div className="error">{message}</div></main>;
  if (!data) return <main className="shell"><p>Loading…</p></main>;

  return <main className="shell narrow">
    <div className="eyebrow">A private Aftercare Registry</div>
    <h1>{data.registry.familyName}</h1>
    <p className="lead">{data.registry.message || "Thank you for being here. If you'd like to help, choose something that feels manageable."}</p>
    <div className="task-grid">{data.tasks.map(task=>
      <button key={task.id} className="task-card" onClick={()=>setSelected(task)}>
        <div className="status-dot">{task.publicStatus === "covered" ? "✓" : "○"}</div>
        <div><strong>{task.title}</strong><p>{task.description}</p><small>{task.publicStatus === "covered" ? "Already covered" : "Could use some help"}</small></div>
      </button>
    )}</div>
    {selected && <CommitForm task={selected} onClose={()=>setSelected(undefined)} />}
  </main>;
}

function CommitForm({task,onClose}:{task:Task;onClose:()=>void}) {
  const [name,setName]=useState(""); const [contact,setContact]=useState(""); const [availability,setAvailability]=useState("I'm flexible"); const [note,setNote]=useState(""); const [result,setResult]=useState(""); const [error,setError]=useState("");
  async function submit(e:FormEvent){e.preventDefault();setError("");try{const r=await api<{recoveryCode:string}>("/commitments",{method:"POST",body:JSON.stringify({taskId:task.id,supporterName:name,supporterContact:contact,availability,note})});setResult(r.recoveryCode);}catch(e){setError((e as Error).message)}}
  if(result) return <div className="modal"><div className="modal-card"><h2>Thank you, {name}.</h2><p>Your offer to help with <strong>{task.title}</strong> has been recorded.</p><div className="recovery"><span>Your recovery code</span><strong>{result}</strong></div><p className="small">Keep this code. You can use it later to check or update your commitment.</p><button className="button primary" onClick={onClose}>Done</button></div></div>;
  return <div className="modal"><div className="modal-card"><button className="close" onClick={onClose}>×</button><div className="eyebrow">Offer help</div><h2>{task.title}</h2><p>{task.description}</p><form className="form" onSubmit={submit}>
    <label>Your name<input value={name} onChange={e=>setName(e.target.value)} required /></label>
    <label>Phone or email <span className="optional">optional</span><input value={contact} onChange={e=>setContact(e.target.value)} /></label>
    <label>When would you like to help?<select value={availability} onChange={e=>setAvailability(e.target.value)}><option>I'm flexible</option><option>I can help on a specific day</option><option>I'll arrange a time with the family</option><option>I'm not sure yet</option></select></label>
    <label>Anything else? <span className="optional">optional</span><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="For example, what you can bring or do..." /></label>
    {error && <div className="error">{error}</div>}<button className="button primary">Offer to help</button>
  </form></div></div>;
}

function Recover() {
  const [code,setCode]=useState(""); const [data,setData]=useState<any>(); const [error,setError]=useState("");
  async function submit(e:FormEvent){e.preventDefault();setError("");try{setData(await api<any>("/recover",{method:"POST",body:JSON.stringify({code})}))}catch(e){setError((e as Error).message)}}
  return <section id="recover" className="recover"><div><div className="eyebrow">Already offered?</div><h2>Find your commitment.</h2><p>Enter the recovery code you received when you offered to help.</p></div><form onSubmit={submit} className="inline-form"><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="ABC123" required /><button className="button secondary">Find it</button></form>{error&&<div className="error">{error}</div>}{data&&<div className="commitment-result"><strong>{data.commitment.taskTitle}</strong><span>{statusLabel(data.commitment.status)}</span><p>For {data.commitment.familyName} · {data.commitment.availability || "No timing preference recorded."}</p></div>}</section>;
}

function statusLabel(status:string){return ({offered:"Offered",confirmed:"Confirmed",in_progress:"In progress",completed:"Completed",unable_to_help:"Unable to help"} as Record<string,string>)[status] || status;}

function Admin({slug,token}:{slug:string;token:string}) {
  const [data,setData]=useState<any>(); const [error,setError]=useState("");
  async function load(){try{setData(await api<any>(`/admin?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`))}catch(e){setError((e as Error).message)}}
  useEffect(()=>{load()},[]);
  if(error)return <main className="shell"><div className="error">{error}</div></main>;
  if(!data)return <main className="shell"><p>Loading dashboard…</p></main>;
  const grouped = data.tasks.reduce((acc:any,row:any)=>{(acc[row.id]??=[]).push(row);return acc},{} as Record<string,any[]>);
  return <main className="shell"><div className="eyebrow">Professional dashboard</div><h1>{data.registry.familyName}</h1><p className="lead">One view of what is covered, what has been offered and what still needs attention.</p>
    <div className="summary"><Stat n={data.tasks.filter((r:any)=>r.commitmentStatus==="completed").length} t="Completed" /><Stat n={data.tasks.filter((r:any)=>["confirmed","in_progress"].includes(r.commitmentStatus)).length} t="Confirmed / active" /><Stat n={data.tasks.filter((r:any)=>!r.commitmentStatus).length} t="Needs help" /></div>
    <div className="admin-list">{Object.entries(grouped).map(([taskId,rows]:any)=>{const row=rows[0]; const commitments=rows.filter((r:any)=>r.commitmentId); return <section className="admin-task" key={taskId}><div className="admin-task-head"><div><h3>{row.title}</h3><p>{row.description}</p></div><span className={`pill ${commitments.length?'covered':''}`}>{commitments.length?'Support offered':'Needs help'}</span></div>{commitments.map((c:any)=><div className="commit-row" key={c.commitmentId}><strong>{c.supporterName}</strong><span>{statusLabel(c.commitmentStatus)}</span><span>{c.availability || "Flexible"}</span><span>{c.note}</span></div>)}</section>})}</div>
  </main>;
}
function Stat({n,t}:{n:number;t:string}){return <div className="stat"><strong>{n}</strong><span>{t}</span></div>}

export default function App(){
  const path=location.pathname;
  if(path.startsWith("/r/")) return <><Header/><Registry slug={path.split("/")[2]}/></>;
  if(path==="/admin") { const q=new URLSearchParams(location.search); return <><Header/><Admin slug={q.get("slug")||""} token={q.get("token")||""}/></>; }
  return <><Header/><Home/><footer>Aftercare Registry · A practical support concept · Not a medical or clinical service</footer></>;
}