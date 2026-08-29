import React, { useCallback, useEffect, useMemo, useState } from "react";

type Revision = {
  version:number; measured_on:string; standing_height_mm:number; sitting_height_mm:number|null; weight_g:number|null;
  correction_reason:string|null; created_at:string;
};
type Measurement = {
  id:string; measured_on:string; standing_height_mm:number; sitting_height_mm:number|null; weight_g:number|null;
  status:"ACTIVE"|"VOIDED"; version:number; created_at:string; revisions:Revision[];
};
type Profile = {
  id:string; account_id:string; username:string; display_name:string; birth_date:string; birth_date_source:"SELF_REPORTED"; formula_sex:"female"|"male";
  measurements:Measurement[];
  reference:{stage?:string;reason?:string;formulaId?:string;implementationHash?:string;parameterHash?:string};
};
type SessionData = {
  authenticated:boolean;
  account?:{id:string;username:string;role:"USER"|"ADMIN";passwordChangeRequired:boolean};
  profile?:Profile; profiles?:Profile[];
};

async function api(path:string, csrfToken:string, options:RequestInit={}) {
  const response=await fetch(`/api/${path}`,{...options,headers:{"content-type":"application/json","x-csrf-token":csrfToken,...(options.headers??{})}});
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error??`エラー (${response.status})`);
  return result;
}

export default function App() {
  const [csrf,setCsrf]=useState("");
  const [data,setData]=useState<SessionData>({authenticated:false});
  const [message,setMessage]=useState("");
  const [tab,setTab]=useState<"overview"|"record"|"profile">("overview");
  
  const load=useCallback(async()=>{
    if(!csrf) return;
    try { setData(await api("session",csrf)); } catch(error) { setMessage((error as Error).message); }
  },[csrf]);
  
  useEffect(()=>{ 
    if(csrf) { void load(); return; } 
    void fetch("/api/csrf").then((response)=>response.json()).then((result)=>setCsrf(result.csrfToken)); 
  },[csrf,load]);

  async function submitAuth(event:React.FormEvent<HTMLFormElement>,path:string) {
    event.preventDefault();
    try {
      const result=await api(path,csrf,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});
      setMessage(result.message??"完了しました");
      await load();
    } catch(error) { setMessage((error as Error).message); }
  }

  if(!data.authenticated) return <Unauthenticated csrf={csrf} message={message} onSubmit={submitAuth}/>;
  
  const account=data.account!;
  const logout=async()=>{ try { await api("logout",csrf,{method:"POST"}); setMessage(""); await load(); } catch(error) { setMessage((error as Error).message); } };
  
  if(account.passwordChangeRequired) {
    return <Shell username={account.username} onLogout={logout}>
      <section className="hero"><div><span className="pill">セキュリティ確認</span><h1>パスワードを<br/>変更してください。</h1><p>仮パスワードでログインしています。続行するには新しいパスワードを設定してください。</p></div></section>
      {message&&<p className="message">{message}</p>}
      <form className="card" onSubmit={(event)=>submitAuth(event,"password/change")}>
        <h2>パスワード変更</h2>
        <label>現在のパスワード<input name="currentPassword" type="password" autoComplete="current-password" required/></label><br/>
        <label>新しいパスワード（12文字以上）<input name="password" type="password" minLength={12} autoComplete="new-password" required/></label>
        <div className="actions"><button className="button">変更して続行</button></div>
      </form>
    </Shell>;
  }
  
  if(account.role==="ADMIN") return <AdminView csrf={csrf} account={account} profiles={data.profiles??[]} message={message} onMessage={setMessage} onLogout={logout} onRefresh={load}/>;
  
  if(!data.profile) return <Shell username={account.username} onLogout={logout}><div className="card"><h2>プロフィールを読み込めません</h2></div></Shell>;
  
  return <UserView csrf={csrf} username={account.username} profile={data.profile} tab={tab} setTab={setTab} message={message} onMessage={setMessage} onRefresh={load} onLogout={logout}/>;
}

function Unauthenticated({csrf,message,onSubmit}:{csrf:string;message:string;onSubmit:(event:React.FormEvent<HTMLFormElement>,path:string)=>void}) {
  return <div className="shell"><header className="topbar"><div className="brand">身体成長<small>Body Growth Record</small></div></header><main className="container">
    <section className="hero"><div><span className="pill">個人の成長記録</span><h1>成長を、正確に<br/>積み重ねる。</h1><p>本人だけが自分の測定履歴を記録・確認する、個人利用向けの記録環境です。</p></div><div className="notice">このサービスは医療診断を行いません。身体成長の表示は身長と年齢から計算した参考情報です。</div></section>
    {message&&<p className={`message ${message.includes("エラー")?"error":""}`}>{message}</p>}
    <div className="auth-wrap">
      <form className="card" onSubmit={(event)=>onSubmit(event,"login")}><h2>ログイン</h2>
        <label>ユーザーID<input name="username" autoComplete="username" required/></label><br/>
        <label>パスワード<input name="password" type="password" autoComplete="current-password" required/></label>
        <div className="actions"><button className="button">ログイン</button></div>
      </form>
      <form className="card" onSubmit={(event)=>onSubmit(event,"register")}><h2>利用者登録</h2>
        <div className="form-grid"><label>ユーザーID<input name="username" minLength={3} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}" autoComplete="username" required/></label><label>表示名<input name="displayName" autoComplete="name" required/></label></div><br/>
        <div className="form-grid"><label>生年月日（本人入力・自己申告）<input name="birthDate" type="date" required/></label><label>formula区分<select name="formulaSex" required defaultValue=""><option value="" disabled>選択してください</option><option value="female">female</option><option value="male">male</option></select></label></div><br/>
        <label>パスワード（12文字以上）<input name="password" type="password" minLength={12} autoComplete="new-password" required/></label>
        <p className="subtle">メールアドレスは登録しません。ユーザーIDは英小文字・数字・._- を使えます。</p>
        <div className="actions"><button className="button">登録して開始</button></div>
      </form>
    </div>
  </main></div>;
}

function Shell({username,onLogout,children}:{username:string;onLogout:()=>void;children:React.ReactNode}) {
  return <div className="shell"><header className="topbar"><div className="brand">身体成長<small>{username}</small></div><button className="button ghost" onClick={onLogout}>ログアウト</button></header><main className="container">{children}</main></div>;
}

function UserView({csrf,username,profile,tab,setTab,message,onMessage,onRefresh,onLogout}:{csrf:string;username:string;profile:Profile;tab:"overview"|"record"|"profile";setTab:(tab:"overview"|"record"|"profile")=>void;message:string;onMessage:(message:string)=>void;onRefresh:()=>Promise<void>;onLogout:()=>void}) {
  return <Shell username={username} onLogout={onLogout}>
    <section className="hero"><div><span className="pill">本人内の縦断履歴</span><h1>身体成長の概要</h1><p>比較やランキングではなく、ご自身の測定履歴だけを継続して確認します。</p></div></section>
    <div className="tabs"><button className={`tab ${tab==="overview"?"active":""}`} onClick={()=>setTab("overview")}>概要</button><button className={`tab ${tab==="record"?"active":""}`} onClick={()=>setTab("record")}>測定を登録</button><button className={`tab ${tab==="profile"?"active":""}`} onClick={()=>setTab("profile")}>プロフィール</button></div>
    {message&&<p className="message">{message}</p>}
    {tab==="overview"&&<ProfileOverview profile={profile} csrf={csrf} editable onDone={async(next)=>{onMessage(next);await onRefresh();}}/>}
    {tab==="record"&&<MeasurementForm csrf={csrf} onDone={async(next)=>{onMessage(next);await onRefresh();setTab("overview");}}/>}
    {tab==="profile"&&<ProfileForm profile={profile} csrf={csrf} onDone={async(next)=>{onMessage(next);await onRefresh();setTab("overview");}}/>}
  </Shell>;
}

function ProfileOverview({profile,csrf,editable,onDone}:{profile:Profile;csrf:string;editable?:boolean;onDone:(message:string)=>void}) {
  const active=useMemo(()=>profile.measurements.filter((measurement)=>measurement.status==="ACTIVE"),[profile.measurements]);
  const latest=active[0], previous=active[1];
  const diff=latest&&previous?latest.standing_height_mm-previous.standing_height_mm:null;
  const days=latest&&previous?Math.round((new Date(latest.measured_on).getTime()-new Date(previous.measured_on).getTime())/86400000):null;
  return <div className="grid">
    <section className="card span-4"><div className="section-title"><h2>最新の有効測定</h2><span className="pill">ACTIVE</span></div><div className="metric">{latest?`${(latest.standing_height_mm/10).toFixed(1)} cm`:"—"}</div><div className="subtle">{latest?.measured_on??"測定なし"}</div></section>
    <section className="card span-4"><div className="section-title"><h2>前回との差</h2></div><div className="metric">{diff===null?"—":`${diff>=0?"+":""}${(diff/10).toFixed(1)} cm`}</div><div className="subtle">{days===null?"比較できる測定がありません":`実経過 ${days} 日`}</div></section>
    <section className="card span-4"><div className="section-title"><h2>身体成長の参考</h2></div><div className="metric" style={{fontSize:"1.35rem"}}>{profile.reference.stage??profile.reference.reason}</div><div className="subtle">本人入力・自己申告の生年月日を使用<br/>Moore 2015 height-only<br/>{profile.reference.formulaId??"計算定義未適用"}</div></section>
    <section className="card span-7"><div className="section-title"><h2>身長推移</h2><span className="subtle">本人内のみ</span></div><div className="chart">{[...active].reverse().map((measurement)=>{const heights=active.map((item)=>item.standing_height_mm);const min=Math.min(...heights)-30;const max=Math.max(...heights)+30;return <div className="bar" key={measurement.id} style={{height:`${Math.max(18,(measurement.standing_height_mm-min)/(max-min||1)*160)}px`}} title={`${(measurement.standing_height_mm/10).toFixed(1)} cm`}><span>{measurement.measured_on.slice(5)}</span></div>;})}</div><p className="subtle">グラフの値は下の表でも確認できます。</p></section>
    <section className="card span-5"><div className="notice danger-note"><strong>必ずお読みください</strong><br/>この表示は身長と年齢から計算した参考であり、医療診断、将来身長予測、練習や選抜の判断には使用できません。懸念がある場合は医療専門家へ相談してください。</div></section>
    <section className="card span-12"><div className="section-title"><h2>測定履歴</h2><span className="subtle">全revisionを確認できます</span></div><div className="table-wrap"><table><thead><tr><th>測定日</th><th>立位身長</th><th>座高</th><th>体重</th><th>状態</th><th>Version</th><th>revision</th>{editable&&<th>操作</th>}</tr></thead><tbody>{profile.measurements.map((measurement)=><tr key={measurement.id}><td>{measurement.measured_on}</td><td>{(measurement.standing_height_mm/10).toFixed(1)} cm</td><td>{measurement.sitting_height_mm===null?"未入力":`${(measurement.sitting_height_mm/10).toFixed(1)} cm`}</td><td>{measurement.weight_g===null?"未入力":`${(measurement.weight_g/1000).toFixed(1)} kg`}</td><td className={`status ${measurement.status==="VOIDED"?"voided":""}`}>{measurement.status==="ACTIVE"?"有効":"無効化済み"}</td><td>{measurement.version}</td><td><RevisionList revisions={measurement.revisions}/></td>{editable&&<td><MeasurementActions measurement={measurement} csrf={csrf} onDone={onDone}/></td>}</tr>)}</tbody></table></div></section>
  </div>;
}

function RevisionList({revisions}:{revisions:Revision[]}) {
  return <details><summary>{revisions.length}件</summary><ul className="subtle">{revisions.map((revision)=><li key={revision.version}>v{revision.version}: {revision.measured_on} / {(revision.standing_height_mm/10).toFixed(1)}cm{revision.correction_reason?`（${revision.correction_reason}）`:""}</li>)}</ul></details>;
}

function MeasurementActions({measurement,csrf,onDone}:{measurement:Measurement;csrf:string;onDone:(message:string)=>void}) {
  async function run(action:"correct"|"void") {
    try {
      const payload:Record<string,unknown>={expectedVersion:measurement.version};
      if(action==="correct") { payload.measuredOn=window.prompt("測定日",measurement.measured_on);payload.heightCm=window.prompt("立位身長 cm",String(measurement.standing_height_mm/10));payload.sittingHeightCm=window.prompt("座高 cm（未入力可）",measurement.sitting_height_mm===null?"":String(measurement.sitting_height_mm/10));payload.weightKg=window.prompt("体重 kg（未入力可）",measurement.weight_g===null?"":String(measurement.weight_g/1000));payload.reason=window.prompt("訂正理由（必須）",""); }
      if(action==="void") payload.reason=window.prompt("無効化理由","");
      if(!payload.reason && action === "correct") return;
      await api(`measurements/${measurement.id}/${action}`,csrf,{method:"POST",body:JSON.stringify(payload)});
      onDone(action==="correct"?"訂正を新しいversionとして保存しました":"測定を無効化しました");
    } catch(error) { onDone((error as Error).message); }
  }
  return <div className="actions" style={{margin:0}}>{measurement.status==="ACTIVE"&&<><button className="button secondary" type="button" onClick={()=>run("correct")}>訂正</button><button className="button danger" type="button" onClick={()=>run("void")}>無効化</button></>}</div>;
}

function MeasurementForm({csrf,onDone}:{csrf:string;onDone:(message:string)=>void}) {
  return <form className="card" onSubmit={async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);try {await api("measurements",csrf,{method:"POST",body:JSON.stringify({measuredOn:form.get("measuredOn"),heightCm:form.get("heightCm"),sittingHeightCm:form.get("sittingHeightCm")||null,weightKg:form.get("weightKg")||null,idempotencyKey:crypto.randomUUID()})});onDone("測定を登録しました");} catch(error) {onDone((error as Error).message);}}}><div className="section-title"><h2>測定を登録</h2><span className="pill">mm / gで安全に保存</span></div><div className="form-grid"><label>測定日（必須）<input name="measuredOn" type="date" required/></label><label>立位身長 cm（必須）<input name="heightCm" type="number" step=".1" min="40" max="250" required/></label><label>座高 cm（任意）<input name="sittingHeightCm" type="number" step=".1" min="20" max="180"/></label><label>体重 kg（任意）<input name="weightKg" type="number" step=".1" min="2" max="300"/></label></div><p className="subtle">未入力値をゼロ・平均値・前回値で補完しません。</p><div className="actions"><button className="button">測定を保存</button></div></form>;
}

function ProfileForm({profile,csrf,onDone}:{profile:Profile;csrf:string;onDone:(message:string)=>void}) {
  return <form className="card" onSubmit={async(event)=>{event.preventDefault();try {await api("profile",csrf,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});onDone("プロフィールを更新しました");}catch(error){onDone((error as Error).message);}}}><h2>本人プロフィール</h2><div className="form-grid"><label>表示名<input name="displayName" defaultValue={profile.display_name} required/></label><label>生年月日（本人入力・自己申告）<input name="birthDate" type="date" defaultValue={profile.birth_date} required/></label><label>formula区分<select name="formulaSex" defaultValue={profile.formula_sex}><option value="female">female</option><option value="male">male</option></select></label></div><p className="subtle">自己申告の生年月日は参考表示にのみ使用し、診断や将来予測には使用しません。このプロフィールと測定記録は、ご本人だけが変更できます。</p><div className="actions"><button className="button">更新</button></div></form>;
}

function AdminView({csrf,account,profiles,message,onMessage,onRefresh,onLogout}:{csrf:string;account:NonNullable<SessionData["account"]>;profiles:Profile[];message:string;onMessage:(message:string)=>void;onRefresh:()=>Promise<void>;onLogout:()=>void}) {
  return <Shell username={account.username} onLogout={onLogout}>
    <section className="hero"><div><span className="pill">閲覧専用管理</span><h1>利用者の記録を<br/>確認する。</h1><p>全利用者・プロフィール・測定・revisionを閲覧できます。利用者のデータは変更できません。</p></div></section>
    {message&&<p className="message">{message}</p>}
    {!profiles.length?<div className="card"><h2>利用者はまだ登録されていません</h2></div>:profiles.map((profile)=><section className="card" key={profile.id} style={{marginBottom:"1.25rem"}}><div className="section-title"><h2>{profile.display_name} <span className="subtle">/ {profile.username}</span></h2><span className="pill">USER</span></div><p className="subtle">生年月日（本人入力・自己申告）: {profile.birth_date} / formula区分: {profile.formula_sex}</p><ProfileOverview profile={profile} csrf={csrf} onDone={onMessage}/><TemporaryPasswordForm csrf={csrf} profile={profile} onDone={async(next)=>{onMessage(next);await onRefresh();}}/></section>)}
  </Shell>;
}

function TemporaryPasswordForm({csrf,profile,onDone}:{csrf:string;profile:Profile;onDone:(message:string)=>void}) {
  return <form className="card" onSubmit={async(event)=>{event.preventDefault();try {const form=new FormData(event.currentTarget);await api("admin/temporary-password",csrf,{method:"POST",body:JSON.stringify({accountId:profile.account_id,temporaryPassword:form.get("temporaryPassword")})});event.currentTarget.reset();onDone("仮パスワードを設定しました。既存sessionは失効し、次回ログイン時に変更が必要です。");}catch(error){onDone((error as Error).message);}}}><h3>仮パスワード設定</h3><label>利用者用の仮パスワード（12文字以上）<input name="temporaryPassword" type="password" minLength={12} autoComplete="new-password" required/></label><p className="subtle">平文は表示・監査ログへの記録をしません。</p><div className="actions"><button className="button secondary">仮パスワードを設定</button></div></form>;
}
