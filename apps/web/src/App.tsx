import React, { useCallback, useEffect, useMemo, useState } from "react";

type Revision = {
  version: number;
  measured_on: string;
  standing_height_mm: number;
  weight_g: number | null;
  correction_reason: string | null;
  created_at: string;
};
type Measurement = {
  id: string;
  measured_on: string;
  standing_height_mm: number;
  weight_g: number | null;
  status: "ACTIVE" | "VOIDED";
  version: number;
  created_at: string;
  revisions: Revision[];
};
type Profile = {
  id: string;
  account_id: string;
  username: string;
  display_name: string;
  birth_date: string;
  birth_date_source: "SELF_REPORTED";
  formula_sex: "female" | "male";
  measurements: Measurement[];
  reference: {
    stage?: string;
    reason?: string;
    formulaId?: string;
    implementationHash?: string;
    parameterHash?: string;
  };
};
type SessionData = {
  authenticated: boolean;
  account?: {
    id: string;
    username: string;
    role: "USER" | "ADMIN";
    passwordChangeRequired: boolean;
  };
  profile?: Profile;
  profiles?: Profile[];
};
type AuthSubmit = (
  event: React.FormEvent<HTMLFormElement>,
  path: "login" | "register",
) => Promise<void>;
async function api(path: string, csrfToken: string, options: RequestInit = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      ...(options.headers ?? {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error ?? `エラー (${response.status})`);
  return result;
}
function Notice({ message }: { message: string }) {
  return message ? (
    <p
      className={`message ${/エラー|失敗|できません/.test(message) ? "error" : ""}`}
      role={/エラー|失敗|できません/.test(message) ? "alert" : "status"}
    >
      {message}
    </p>
  ) : null;
}
export default function App() {
  const [csrf, setCsrf] = useState("");
  const [data, setData] = useState<SessionData>({ authenticated: false });
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"overview" | "record" | "profile">("overview");
  const load = useCallback(async () => {
    if (!csrf) return;
    try {
      setData(await api("session", csrf));
    } catch (error) {
      setMessage((error as Error).message);
    }
  }, [csrf]);
  useEffect(() => {
    if (csrf) {
      void load();
      return;
    }
    void fetch("/api/csrf")
      .then((r) => r.json())
      .then((r) => setCsrf(r.csrfToken));
  }, [csrf, load]);
  async function submitAuth(
    event: React.FormEvent<HTMLFormElement>,
    path: string,
  ) {
    event.preventDefault();
    try {
      const result = await api(path, csrf, {
        method: "POST",
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      });
      setMessage(result.message ?? "完了しました");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  if (!data.authenticated)
    return (
      <Unauthenticated csrf={csrf} message={message} onSubmit={submitAuth} />
    );
  const account = data.account!;
  const logout = async () => {
    try {
      await api("logout", csrf, { method: "POST" });
      setMessage("");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  if (account.passwordChangeRequired)
    return (
      <Shell username={account.username} onLogout={logout}>
        <section className="hero">
          <div>
            <span className="pill">セキュリティ確認</span>
            <h1>
              新しいパスワードを
              <br />
              設定してください。
            </h1>
            <p>
              仮パスワードでログインしています。続行するには新しいパスワードを設定してください。
            </p>
          </div>
        </section>
        <Notice message={message} />
        <PasswordChange
          csrf={csrf}
          onDone={async (next) => {
            setMessage(next);
            await load();
          }}
        />
      </Shell>
    );
  if (account.role === "ADMIN")
    return (
      <AdminView
        csrf={csrf}
        account={account}
        profiles={data.profiles ?? []}
        message={message}
        onMessage={setMessage}
        onRefresh={load}
        onLogout={logout}
      />
    );
  if (!data.profile)
    return (
      <Shell username={account.username} onLogout={logout}>
        <div className="card">
          <h2>プロフィールを読み込めません</h2>
        </div>
      </Shell>
    );
  return (
    <UserView
      csrf={csrf}
      username={account.username}
      profile={data.profile}
      tab={tab}
      setTab={setTab}
      message={message}
      onMessage={setMessage}
      onRefresh={load}
      onLogout={logout}
    />
  );
}
function Unauthenticated({
  csrf,
  message,
  onSubmit,
}: {
  csrf: string;
  message: string;
  onSubmit: AuthSubmit;
}) {
  const [register, setRegister] = useState(false);
  return (
    <div className="shell auth-page">
      <header className="topbar">
        <div className="brand">
          身体成長<small>Body Growth Record</small>
        </div>
      </header>
      <main className="container auth-container">
        <section className="hero auth-hero">
          <div>
            <span className="pill">個人の成長記録</span>
            <h1>
              成長を、ていねいに
              <br />
              記録する。
            </h1>
            <p>ご自身の測定履歴だけを、安全に積み重ねて確認できます。</p>
          </div>
          <div className="growth-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <span>身長</span>
          </div>
        </section>
        <Notice message={message} />
        <div className="auth-card card">
          <div className="auth-heading">
            <div>
              <span className="eyebrow">BODY GROWTH</span>
              <h2>{register ? "利用者登録" : "ログイン"}</h2>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => setRegister(!register)}
            >
              {register ? "ログインに戻る" : "初めての方はこちら"}
            </button>
          </div>
          {register ? (
            <RegisterForm csrf={csrf} onSubmit={onSubmit} />
          ) : (
            <LoginForm csrf={csrf} onSubmit={onSubmit} />
          )}
        </div>
      </main>
    </div>
  );
}
function LoginForm({ csrf, onSubmit }: { csrf: string; onSubmit: AuthSubmit }) {
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { errors, validate, clear } = useJapaneseValidation();
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        if (!validate(e)) return;
        setSubmitting(true);
        try {
          await onSubmit(e, "login");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <label>
        ユーザーID
        <input
          name="username"
          autoComplete="username"
          required
          aria-invalid={Boolean(errors.username)}
          aria-describedby="username-error"
          onInput={() => clear("username")}
        />
        <FieldError name="username" errors={errors} />
      </label>
      <label>
        パスワード
        <div className="password-field">
          <input
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-invalid={Boolean(errors.password)}
            aria-describedby="password-error"
            onInput={() => clear("password")}
          />
          <button
            type="button"
            className="reveal"
            onClick={() => setShow(!show)}
          >
            {show ? "隠す" : "表示"}
          </button>
        </div>
        <FieldError name="password" errors={errors} />
      </label>
      <button className="button wide" disabled={!csrf || submitting}>
        {submitting ? "ログイン中…" : "ログイン"}
      </button>
      <p className="subtle auth-foot">管理者もこの画面からログインします。</p>
    </form>
  );
}
function RegisterForm({
  csrf,
  onSubmit,
}: {
  csrf: string;
  onSubmit: AuthSubmit;
}) {
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { errors, validate, clear } = useJapaneseValidation();
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        if (!validate(e)) return;
        setSubmitting(true);
        try {
          await onSubmit(e, "register");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="form-grid">
        <label>
          ユーザーID
          <input
            name="username"
            minLength={3}
            maxLength={64}
            pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}"
            autoComplete="username"
            required
            aria-invalid={Boolean(errors.username)}
            aria-describedby="username-error"
            onInput={() => clear("username")}
          />
          <span className="field-help">英数字と . _ - ／3文字以上</span>
          <FieldError name="username" errors={errors} />
        </label>
        <label>
          表示名
          <input
            name="displayName"
            autoComplete="name"
            maxLength={100}
            required
            aria-invalid={Boolean(errors.displayName)}
            aria-describedby="displayName-error"
            onInput={() => clear("displayName")}
          />
          <FieldError name="displayName" errors={errors} />
        </label>
        <label>
          生年月日
          <input
            name="birthDate"
            type="date"
            required
            aria-invalid={Boolean(errors.birthDate)}
            aria-describedby="birthDate-error"
            onInput={() => clear("birthDate")}
          />
          <FieldError name="birthDate" errors={errors} />
        </label>
        <label>
          成長参考の計算区分
          <select
            name="formulaSex"
            required
            defaultValue=""
            aria-invalid={Boolean(errors.formulaSex)}
            aria-describedby="formulaSex-error"
            onInput={() => clear("formulaSex")}
          >
            <option value="" disabled>
              選択してください
            </option>
            <option value="female">女性用の計算式</option>
            <option value="male">男性用の計算式</option>
          </select>
          <FieldError name="formulaSex" errors={errors} />
        </label>
      </div>
      <label>
        パスワード（12文字以上）
        <div className="password-field">
          <input
            name="password"
            type={show ? "text" : "password"}
            minLength={12}
            autoComplete="new-password"
            required
            aria-invalid={Boolean(errors.password)}
            aria-describedby="password-error"
            onInput={() => clear("password")}
          />
          <button
            type="button"
            className="reveal"
            onClick={() => setShow(!show)}
          >
            {show ? "隠す" : "表示"}
          </button>
        </div>
        <FieldError name="password" errors={errors} />
      </label>
      <p className="subtle">生年月日は参考表示にのみ使用します。</p>
      <button className="button wide" disabled={!csrf || submitting}>
        {submitting ? "登録中…" : "登録して開始"}
      </button>
    </form>
  );
}
function Shell({
  username,
  onLogout,
  children,
}: {
  username: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          身体成長<small>{username}</small>
        </div>
        <button className="button ghost" onClick={onLogout}>
          ログアウト
        </button>
      </header>
      <main className="container">{children}</main>
    </div>
  );
}
function PasswordChange({
  csrf,
  onDone,
}: {
  csrf: string;
  onDone: (message: string) => Promise<void>;
}) {
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      className="card narrow-card"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          const form = new FormData(event.currentTarget);
          await api("password/change", csrf, {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(form)),
          });
          await onDone("パスワードを変更しました。");
        } catch (error) {
          await onDone((error as Error).message);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <h2>パスワード変更</h2>
      <label>
        現在のパスワード
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        新しいパスワード（12文字以上）
        <div className="password-field">
          <input
            name="password"
            type={show ? "text" : "password"}
            minLength={12}
            autoComplete="new-password"
            required
          />
          <button
            type="button"
            className="reveal"
            onClick={() => setShow(!show)}
          >
            {show ? "隠す" : "表示"}
          </button>
        </div>
      </label>
      <button className="button" disabled={submitting}>
        {submitting ? "変更中…" : "変更して続行"}
      </button>
    </form>
  );
}
function UserView({
  csrf,
  username,
  profile,
  tab,
  setTab,
  message,
  onMessage,
  onRefresh,
  onLogout,
}: {
  csrf: string;
  username: string;
  profile: Profile;
  tab: "overview" | "record" | "profile";
  setTab: (tab: "overview" | "record" | "profile") => void;
  message: string;
  onMessage: (message: string) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}) {
  return (
    <Shell username={username} onLogout={onLogout}>
      <section className="hero">
        <div>
          <span className="pill">本人の記録</span>
          <h1>身体成長の概要</h1>
          <p>ご自身の測定履歴を、わかりやすく振り返ります。</p>
        </div>
      </section>
      <div className="tabs">
        <button
          className={`tab ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          概要
        </button>
        <button
          className={`tab ${tab === "record" ? "active" : ""}`}
          onClick={() => setTab("record")}
        >
          測定を登録
        </button>
        <button
          className={`tab ${tab === "profile" ? "active" : ""}`}
          onClick={() => setTab("profile")}
        >
          プロフィール
        </button>
      </div>
      <Notice message={message} />
      {tab === "overview" && (
        <ProfileOverview
          profile={profile}
          csrf={csrf}
          editable
          onDone={async (next) => {
            onMessage(next);
            await onRefresh();
          }}
          onRecord={() => setTab("record")}
        />
      )}{" "}
      {tab === "record" && (
        <MeasurementForm
          csrf={csrf}
          onDone={async (next) => {
            onMessage(next);
            await onRefresh();
            setTab("overview");
          }}
        />
      )}
      {tab === "profile" && (
        <ProfileForm
          profile={profile}
          csrf={csrf}
          onDone={async (next) => {
            onMessage(next);
            await onRefresh();
            setTab("overview");
          }}
        />
      )}
    </Shell>
  );
}
function ProfileOverview({
  profile,
  csrf,
  editable,
  onDone,
  onRecord,
}: {
  profile: Profile;
  csrf: string;
  editable?: boolean;
  onDone: (message: string) => void;
  onRecord?: () => void;
}) {
  const active = useMemo(
    () => profile.measurements.filter((m) => m.status === "ACTIVE"),
    [profile.measurements],
  );
  const latest = active[0],
    previous = active[1];
  const heightDiff =
    latest && previous
      ? latest.standing_height_mm - previous.standing_height_mm
      : null;
  const weightDiff =
    latest?.weight_g != null && previous?.weight_g != null
      ? latest.weight_g - previous.weight_g
      : null;
  return (
    <div className="grid">
      {!latest ? (
        <section className="card span-12 empty-state">
          <div className="empty-icon">＋</div>
          <h2>最初の測定を登録しましょう</h2>
          <p className="subtle">
            身長を入力すると、身体成長の推移を確認できるようになります。体重は任意です。
          </p>
          {onRecord ? (
            <button className="button" onClick={onRecord}>
              最初の測定を登録
            </button>
          ) : (
            <p className="subtle">この利用者はまだ測定を登録していません。</p>
          )}
        </section>
      ) : (
        <>
          <MetricCard
            title="最新の身長"
            value={`${(latest.standing_height_mm / 10).toFixed(1)} cm`}
            note={latest.measured_on}
          />
          <MetricCard
            title="前回からの身長差"
            value={
              heightDiff === null
                ? "—"
                : `${heightDiff >= 0 ? "+" : ""}${(heightDiff / 10).toFixed(1)} cm`
            }
            note={
              previous ? "前回の有効測定との比較" : "比較できる測定がありません"
            }
          />
          <MetricCard
            title="体重"
            value={
              latest.weight_g == null
                ? "未入力"
                : `${(latest.weight_g / 1000).toFixed(1)} kg`
            }
            note={
              weightDiff === null
                ? "体重は任意です"
                : `前回から ${weightDiff >= 0 ? "+" : ""}${(weightDiff / 1000).toFixed(1)} kg`
            }
          />
          {onRecord && (
            <div className="overview-cta span-12">
              <button className="button" type="button" onClick={onRecord}>
                新しい測定を登録
              </button>
            </div>
          )}
          <TrendCard measurements={active} />
          <ReferenceCard
            reference={profile.reference}
            measuredOn={latest.measured_on}
            formulaSex={profile.formula_sex}
          />
          <section className="card span-12">
            <div className="section-title">
              <h2>測定履歴</h2>
              <span className="subtle">{active.length}件の有効測定</span>
            </div>
            <HistoryTable
              measurements={profile.measurements}
              csrf={csrf}
              editable={editable}
              onDone={onDone}
            />
          </section>
        </>
      )}
    </div>
  );
}
function MetricCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <section className="card span-4">
      <h2 className="card-label">{title}</h2>
      <div className="metric">{value}</div>
      <div className="subtle">{note}</div>
    </section>
  );
}
function TrendCard({ measurements }: { measurements: Measurement[] }) {
  const [mode, setMode] = useState<"height" | "weight">("height");
  const hasWeight = measurements.some((m) => m.weight_g != null);
  const allPoints = [...measurements].reverse();
  const points =
    mode === "weight" ? allPoints.filter((m) => m.weight_g != null) : allPoints;
  return (
    <section className="card span-7">
      <div className="section-title">
        <h2>推移</h2>
        <div className="toggle" role="group" aria-label="表示項目">
          <button
            type="button"
            className={mode === "height" ? "selected" : ""}
            onClick={() => setMode("height")}
          >
            身長
          </button>
          {hasWeight && (
            <button
              type="button"
              className={mode === "weight" ? "selected" : ""}
              onClick={() => setMode("weight")}
            >
              体重
            </button>
          )}
        </div>
      </div>
      <div
        className="chart"
        aria-label={`${mode === "height" ? "身長" : "体重"}推移グラフ`}
      >
        {points.map((m) => {
          const value =
            mode === "height"
              ? m.standing_height_mm / 10
              : (m.weight_g ?? 0) / 1000;
          const values = points.map((p) =>
            mode === "height"
              ? p.standing_height_mm / 10
              : (p.weight_g ?? 0) / 1000,
          );
          const min = Math.min(...values),
            max = Math.max(...values);
          return (
            <div
              className="bar"
              key={m.id}
              style={{
                height: `${Math.max(18, ((value - min) / (max - min || 1)) * 160)}px`,
              }}
            >
              <span>{m.measured_on.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <div className="numeric-table">
        <table>
          <caption className="sr-only">
            {mode === "height" ? "身長" : "体重"}の数値一覧
          </caption>
          <thead>
            <tr>
              <th>測定日</th>
              <th>{mode === "height" ? "身長" : "体重"}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((m) => (
              <tr key={m.id}>
                <td>{m.measured_on}</td>
                <td>
                  {mode === "height"
                    ? `${(m.standing_height_mm / 10).toFixed(1)} cm`
                    : m.weight_g == null
                      ? "未入力"
                      : `${(m.weight_g / 1000).toFixed(1)} kg`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function ReferenceCard({
  reference,
  measuredOn,
  formulaSex,
}: {
  reference: Profile["reference"];
  measuredOn: string;
  formulaSex: Profile["formula_sex"];
}) {
  return (
    <section className="card span-5">
      <div className="section-title">
        <h2>身体成長の参考</h2>
        <span className="pill">参考情報</span>
      </div>
      <dl className="reference-list">
        <div>
          <dt>成長段階</dt>
          <dd>{reference.stage ?? reference.reason ?? "計算情報なし"}</dd>
        </div>
        <div>
          <dt>計算方法</dt>
          <dd>Moore 2015 height-only</dd>
        </div>
        <div>
          <dt>対象測定日</dt>
          <dd>{measuredOn}</dd>
        </div>
        <div>
          <dt>計算区分</dt>
          <dd>{formulaSex === "female" ? "女性用" : "男性用"}</dd>
        </div>
        <div>
          <dt>定義</dt>
          <dd>{reference.formulaId ?? "未適用"}</dd>
        </div>
      </dl>
      <details className="calculation-details">
        <summary>計算情報を表示</summary>
        <p>
          implementation hash: {reference.implementationHash ?? "—"}
          <br />
          parameter hash: {reference.parameterHash ?? "—"}
        </p>
      </details>
      <p className="subtle">
        診断や将来身長予測ではありません。気になることは医療専門家へご相談ください。
      </p>
    </section>
  );
}
function HistoryTable({
  measurements,
  csrf,
  editable,
  onDone,
}: {
  measurements: Measurement[];
  csrf: string;
  editable?: boolean;
  onDone: (message: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>測定日</th>
            <th>身長</th>
            <th>体重</th>
            <th>状態</th>
            <th>詳細</th>
            {editable && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {measurements.map((m) => (
            <tr key={m.id}>
              <td>{m.measured_on}</td>
              <td>{(m.standing_height_mm / 10).toFixed(1)} cm</td>
              <td>
                {m.weight_g == null
                  ? "未入力"
                  : `${(m.weight_g / 1000).toFixed(1)} kg`}
              </td>
              <td className={`status ${m.status === "VOIDED" ? "voided" : ""}`}>
                {m.status === "ACTIVE" ? "有効" : "無効化済み"}
              </td>
              <td>
                <RevisionList revisions={m.revisions} version={m.version} />
              </td>
              {editable && (
                <td>
                  <MeasurementActions
                    measurement={m}
                    csrf={csrf}
                    onDone={onDone}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function RevisionList({
  revisions,
  version,
}: {
  revisions: Revision[];
  version: number;
}) {
  return (
    <details>
      <summary>
        v{version}・履歴{revisions.length}件
      </summary>
      <ul className="subtle">
        {revisions.map((r) => (
          <li key={r.version}>
            v{r.version}: {r.measured_on} /{" "}
            {(r.standing_height_mm / 10).toFixed(1)}cm
            {r.weight_g == null ? "" : ` / ${(r.weight_g / 1000).toFixed(1)}kg`}
            {r.correction_reason ? `（${r.correction_reason}）` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
function MeasurementActions({
  measurement,
  csrf,
  onDone,
}: {
  measurement: Measurement;
  csrf: string;
  onDone: (message: string) => void;
}) {
  const [action, setAction] = useState<"correct" | "void" | null>(null);
  return (
    <>
      {measurement.status === "ACTIVE" && (
        <div className="actions compact">
          <button
            className="button secondary"
            type="button"
            onClick={() => setAction("correct")}
          >
            訂正
          </button>
          <button
            className="button danger"
            type="button"
            onClick={() => setAction("void")}
          >
            無効化
          </button>
        </div>
      )}
      {action && (
        <MeasurementDialog
          measurement={measurement}
          action={action}
          csrf={csrf}
          onClose={() => setAction(null)}
          onSuccess={(message) => {
            setAction(null);
            onDone(message);
          }}
          onError={onDone}
        />
      )}
    </>
  );
}
function MeasurementDialog({
  measurement,
  action,
  csrf,
  onClose,
  onSuccess,
  onError,
}: {
  measurement: Measurement;
  action: "correct" | "void";
  csrf: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const correct = action === "correct";
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="measurement-dialog-title"
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          try {
            const form = new FormData(event.currentTarget);
            const payload: Record<string, unknown> = {
              expectedVersion: measurement.version,
              reason: form.get("reason"),
            };
            if (correct)
              Object.assign(payload, {
                measuredOn: form.get("measuredOn"),
                heightCm: form.get("heightCm"),
                weightKg: form.get("weightKg") || null,
              });
            await api(`measurements/${measurement.id}/${action}`, csrf, {
              method: "POST",
              body: JSON.stringify(payload),
            });
            onSuccess(
              correct
                ? "訂正を新しいversionとして保存しました"
                : "測定を無効化しました",
            );
          } catch (error) {
            onError((error as Error).message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="section-title">
          <h2 id="measurement-dialog-title">
            {correct ? "測定を訂正" : "測定を無効化"}
          </h2>
          <button
            type="button"
            className="close"
            onClick={onClose}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        {correct && (
          <div className="form-grid">
            <label>
              測定日
              <input
                name="measuredOn"
                type="date"
                defaultValue={measurement.measured_on}
                required
              />
            </label>
            <label>
              身長 cm
              <input
                name="heightCm"
                type="number"
                step=".1"
                min="50"
                max="250"
                defaultValue={measurement.standing_height_mm / 10}
                required
              />
            </label>
            <label>
              体重 kg（任意）
              <input
                name="weightKg"
                type="number"
                step=".1"
                min="2"
                max="300"
                defaultValue={
                  measurement.weight_g == null
                    ? ""
                    : measurement.weight_g / 1000
                }
              />
            </label>
          </div>
        )}
        <label>
          {correct ? "訂正理由（必須）" : "無効化理由（必須）"}
          <textarea name="reason" rows={4} required />
        </label>
        <div className="actions">
          <button
            type="button"
            className="button ghost dark"
            onClick={onClose}
            disabled={submitting}
          >
            キャンセル
          </button>
          <button
            className={`button ${correct ? "" : "danger"}`}
            disabled={submitting}
          >
            {submitting ? "保存中…" : correct ? "訂正を保存" : "無効化する"}
          </button>
        </div>
      </form>
    </div>
  );
}
function MeasurementForm({
  csrf,
  onDone,
}: {
  csrf: string;
  onDone: (message: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      className="card narrow-card"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          const form = new FormData(event.currentTarget);
          await api("measurements", csrf, {
            method: "POST",
            body: JSON.stringify({
              measuredOn: form.get("measuredOn"),
              heightCm: form.get("heightCm"),
              weightKg: form.get("weightKg") || null,
              idempotencyKey: crypto.randomUUID(),
            }),
          });
          onDone("測定を登録しました");
        } catch (error) {
          onDone((error as Error).message);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="section-title">
        <h2>測定を登録</h2>
        <span className="pill">身長必須・体重任意</span>
      </div>
      <div className="form-grid">
        <label>
          測定日
          <input
            name="measuredOn"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </label>
        <label>
          身長 cm
          <input
            name="heightCm"
            type="number"
            step=".1"
            min="50"
            max="250"
            required
          />
        </label>
        <label>
          体重 kg（任意）
          <input name="weightKg" type="number" step=".1" min="2" max="300" />
        </label>
      </div>
      <p className="subtle">未入力の体重は補完しません。</p>
      <button className="button" disabled={submitting}>
        {submitting ? "保存中…" : "測定を保存"}
      </button>
    </form>
  );
}
function ProfileForm({
  profile,
  csrf,
  onDone,
}: {
  profile: Profile;
  csrf: string;
  onDone: (message: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      className="card"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          await api("profile", csrf, {
            method: "POST",
            body: JSON.stringify(
              Object.fromEntries(new FormData(event.currentTarget)),
            ),
          });
          onDone("プロフィールを更新しました");
        } catch (error) {
          onDone((error as Error).message);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <h2>本人プロフィール</h2>
      <div className="form-grid">
        <label>
          表示名
          <input
            name="displayName"
            defaultValue={profile.display_name}
            required
          />
        </label>
        <label>
          生年月日
          <input
            name="birthDate"
            type="date"
            defaultValue={profile.birth_date}
            required
          />
        </label>
        <label>
          成長参考の計算区分
          <select name="formulaSex" defaultValue={profile.formula_sex}>
            <option value="female">女性用の計算式</option>
            <option value="male">男性用の計算式</option>
          </select>
        </label>
      </div>
      <p className="subtle">自己申告の生年月日は参考表示にのみ使用します。</p>
      <button className="button" disabled={submitting}>
        {submitting ? "更新中…" : "更新"}
      </button>
    </form>
  );
}
function AdminView({
  csrf,
  account,
  profiles,
  message,
  onMessage,
  onRefresh,
  onLogout,
}: {
  csrf: string;
  account: NonNullable<SessionData["account"]>;
  profiles: Profile[];
  message: string;
  onMessage: (message: string) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const filtered = useMemo(
    () =>
      [...profiles]
        .filter((p) =>
          `${p.display_name} ${p.username}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.display_name.localeCompare(b.display_name, "ja")
            : (b.measurements[0]?.measured_on ?? "").localeCompare(
                a.measurements[0]?.measured_on ?? "",
              ),
        ),
    [profiles, query, sort],
  );
  return (
    <Shell username={account.username} onLogout={onLogout}>
      <section className="hero">
        <div>
          <span className="pill">閲覧専用管理</span>
          <h1>
            利用者の記録を
            <br />
            確認する。
          </h1>
          <p>
            全利用者のプロフィール・測定・revisionを閲覧できます。変更できるのは仮パスワード設定だけです。
          </p>
        </div>
      </section>
      <Notice message={message} />
      <section className="card">
        <div className="admin-toolbar">
          <label className="search-label">
            利用者を検索
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="表示名またはユーザーID"
            />
          </label>
          <label>
            並び順
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="recent">最新測定日</option>
              <option value="name">表示名</option>
            </select>
          </label>
        </div>
        <p className="subtle">{filtered.length}名を表示</p>
        {!filtered.length ? (
          <p>該当する利用者はいません。</p>
        ) : (
          filtered.map((profile) => (
            <AdminProfile
              key={profile.id}
              profile={profile}
              csrf={csrf}
              onMessage={onMessage}
              onRefresh={onRefresh}
            />
          ))
        )}
      </section>
    </Shell>
  );
}
function AdminProfile({
  profile,
  csrf,
  onMessage,
  onRefresh,
}: {
  profile: Profile;
  csrf: string;
  onMessage: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="admin-profile"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span>
          <strong>{profile.display_name}</strong>
          <small>
            {profile.username} · 最新{" "}
            {profile.measurements[0]?.measured_on ?? "未測定"}
          </small>
        </span>
        <span className="pill">閲覧</span>
      </summary>
      {open && (
        <div className="admin-profile-body">
          <p className="subtle">
            生年月日（本人入力）: {profile.birth_date} ／{" "}
            {profile.formula_sex === "female"
              ? "女性用の計算式"
              : "男性用の計算式"}
          </p>
          <ProfileOverview profile={profile} csrf={csrf} onDone={onMessage} />
          <TemporaryPasswordForm
            csrf={csrf}
            profile={profile}
            onDone={async (next) => {
              onMessage(next);
              await onRefresh();
            }}
          />
        </div>
      )}
    </details>
  );
}
function TemporaryPasswordForm({
  csrf,
  profile,
  onDone,
}: {
  csrf: string;
  profile: Profile;
  onDone: (message: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      className="card temporary-password"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          const form = new FormData(event.currentTarget);
          await api("admin/temporary-password", csrf, {
            method: "POST",
            body: JSON.stringify({
              accountId: profile.account_id,
              temporaryPassword: form.get("temporaryPassword"),
            }),
          });
          event.currentTarget.reset();
          onDone(
            "仮パスワードを設定しました。次回ログイン時に変更が必要です。",
          );
        } catch (error) {
          onDone((error as Error).message);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <h3>仮パスワード設定</h3>
      <div className="password-field">
        <input
          name="temporaryPassword"
          type={show ? "text" : "password"}
          minLength={12}
          autoComplete="new-password"
          placeholder="12文字以上"
          required
        />
        <button type="button" className="reveal" onClick={() => setShow(!show)}>
          {show ? "隠す" : "表示"}
        </button>
      </div>
      <p className="subtle">平文は表示・監査ログに記録しません。</p>
      <button className="button secondary" disabled={submitting}>
        {submitting ? "設定中…" : "設定する"}
      </button>
    </form>
  );
}
function useJapaneseValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requiredMessages: Record<string, string> = {
    username: "ユーザーIDを入力してください。",
    password: "パスワードを入力してください。",
    displayName: "表示名を入力してください。",
    birthDate: "生年月日を入力してください。",
    formulaSex: "成長参考の計算区分を選択してください。",
  };
  const validate = (event: React.FormEvent<HTMLFormElement>) => {
    const next: Record<string, string> = {};
    event.currentTarget
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[name]")
      .forEach((field) => {
        if (!field.value.trim())
          next[field.name] =
            requiredMessages[field.name] ?? "入力してください。";
        else if (
          field.name === "username" &&
          !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(field.value)
        )
          next[field.name] =
            "英数字と . _ - を使い、3〜64文字で入力してください。";
        else if (
          field instanceof HTMLInputElement &&
          field.minLength > 0 &&
          field.value.length < field.minLength
        )
          next[field.name] = `${field.minLength}文字以上で入力してください。`;
      });
    setErrors(next);
    if (Object.keys(next).length) event.preventDefault();
    return !Object.keys(next).length;
  };
  const clear = (name: string) =>
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  return { errors, validate, clear };
}

function FieldError({
  name,
  errors,
}: {
  name: string;
  errors: Record<string, string>;
}) {
  return (
    <span id={`${name}-error`} className="field-error" aria-live="polite">
      {errors[name] ?? ""}
    </span>
  );
}
