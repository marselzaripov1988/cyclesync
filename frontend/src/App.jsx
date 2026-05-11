import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";
import { buildMonthGrid, toISODate } from "./calendar";

function AuthPanel({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onAuthed(data.token, data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="panel stack">
      <h2>{mode === "login" ? "Login" : "Create Account"}</h2>
      <form className="stack" onSubmit={submit}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Password (min 8 chars)"
        />
        <button type="submit">{mode === "login" ? "Login" : "Register"}</button>
      </form>
      {error ? <div className="error">{error}</div> : null}
      <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account?" : "Have an account?"}
      </button>
    </div>
  );
}

function ProfileForm({ onSave, initial }) {
  const [name, setName] = useState(initial?.name || "");
  const [lastPeriodStart, setLastPeriodStart] = useState(
    initial?.last_period_start || toISODate(new Date())
  );
  const [cycleLength, setCycleLength] = useState(initial?.cycle_length || 28);
  const [periodLength, setPeriodLength] = useState(initial?.period_length || 5);

  useEffect(() => {
    setName(initial?.name || "");
    setLastPeriodStart(initial?.last_period_start || toISODate(new Date()));
    setCycleLength(initial?.cycle_length || 28);
    setPeriodLength(initial?.period_length || 5);
  }, [initial]);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: name.trim(),
          last_period_start: lastPeriodStart,
          cycle_length: Number(cycleLength),
          period_length: Number(periodLength),
        });
      }}
    >
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="small">Profile name from contact list (for example: Sarah Johnson).</div>
      <input type="date" value={lastPeriodStart} onChange={(e) => setLastPeriodStart(e.target.value)} />
      <div className="small">First day of the most recent period.</div>
      <input
        type="number"
        min={20}
        max={45}
        value={cycleLength}
        onChange={(e) => setCycleLength(e.target.value)}
      />
      <div className="small">Average full cycle length in days (usually 21-35).</div>
      <input
        type="number"
        min={2}
        max={10}
        value={periodLength}
        onChange={(e) => setPeriodLength(e.target.value)}
      />
      <div className="small">Average number of bleeding days per cycle.</div>
      <button type="submit">{initial ? "Update Profile" : "Add Profile"}</button>
    </form>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("cyclesync.token") || "");
  const [user, setUser] = useState(
    localStorage.getItem("cyclesync.user") ? JSON.parse(localStorage.getItem("cyclesync.user")) : null
  );
  const [profiles, setProfiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [calendarMode, setCalendarMode] = useState("classic");
  const [month, setMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [events, setEvents] = useState([]);
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [error, setError] = useState("");

  const monthGrid = useMemo(() => buildMonthGrid(month), [month]);
  const from = monthGrid[0];
  const to = monthGrid[monthGrid.length - 1];

  async function loadProfiles() {
    const data = await apiRequest("/api/profiles", {}, token);
    setProfiles(data.profiles);
    if (data.profiles.length && !data.profiles.some((p) => p.id === activeProfileId)) {
      setActiveProfileId(data.profiles[0].id);
    }
  }

  async function loadEvents() {
    const data = await apiRequest(
      `/api/predictions?from=${toISODate(from)}&to=${toISODate(to)}`,
      {},
      token
    );
    setEvents(data.events);
  }

  useEffect(() => {
    if (!token) return;
    loadProfiles().catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadEvents().catch((err) => setError(err.message));
  }, [token, month, profiles.length]);

  function onAuthed(nextToken, nextUser) {
    setToken(nextToken);
    setUser(nextUser);
    localStorage.setItem("cyclesync.token", nextToken);
    localStorage.setItem("cyclesync.user", JSON.stringify(nextUser));
  }

  async function saveProfile(payload) {
    setError("");
    try {
      if (editing) {
        await apiRequest(
          `/api/profiles/${editing.id}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          },
          token
        );
      } else {
        await apiRequest(
          "/api/profiles",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          token
        );
      }
      setEditing(null);
      await loadProfiles();
      await loadEvents();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeProfile(id) {
    setError("");
    try {
      await apiRequest(`/api/profiles/${id}`, { method: "DELETE" }, token);
      if (activeProfileId === id) {
        const next = profiles.find((p) => p.id !== id);
        setActiveProfileId(next?.id || null);
      }
      await loadProfiles();
      await loadEvents();
    } catch (err) {
      setError(err.message);
    }
  }

  async function connectICloud() {
    setError("");
    try {
      await apiRequest(
        "/api/icloud/connect",
        { method: "POST", body: JSON.stringify({ appleId, appSpecificPassword: appPassword }) },
        token
      );
      setAppPassword("");
      await syncICloud();
    } catch (err) {
      setError(err.message);
    }
  }

  async function syncICloud() {
    setError("");
    try {
      await apiRequest("/api/icloud/sync", { method: "POST" }, token);
      await loadProfiles();
      await loadEvents();
    } catch (err) {
      setError(err.message);
    }
  }

  function logout() {
    localStorage.removeItem("cyclesync.token");
    localStorage.removeItem("cyclesync.user");
    setToken("");
    setUser(null);
    setProfiles([]);
    setEvents([]);
  }

  if (!token) {
    return (
      <div className="app">
        <AuthPanel onAuthed={onAuthed} />
      </div>
    );
  }

  const profileNameById = new Map(profiles.map((p) => [p.id, p.name]));
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const activeEvents = events.filter((e) => !activeProfileId || e.profileId === activeProfileId);
  const classicEventMap = new Map(activeEvents.map((e) => [`${e.date}:${e.type}`, e]));
  const ovulationEvents = events.filter((e) => e.type === "ovulation");
  const ovulationByDate = ovulationEvents.reduce((acc, evt) => {
    const row = { ...evt, profileName: profileNameById.get(evt.profileId) || "Unknown profile" };
    const list = acc.get(evt.date) || [];
    list.push(row);
    acc.set(evt.date, list);
    return acc;
  }, new Map());

  return (
    <div className="app">
      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{user?.email}</strong>
          <button onClick={logout}>Logout</button>
        </div>
        <h3>{editing ? "Edit Profile" : "Add Profile"}</h3>
        <ProfileForm onSave={saveProfile} initial={editing} />
        <h3>Profiles</h3>
        <ul className="profiles">
          {profiles.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setActiveProfileId(p.id)}
                style={{ fontWeight: p.id === activeProfileId ? 700 : 400 }}
              >
                {p.name}
              </button>
              <button onClick={() => setEditing(p)}>Edit</button>
              <button onClick={() => removeProfile(p.id)}>Delete</button>
            </li>
          ))}
        </ul>
        <h3>iCloud Contacts Sync</h3>
        <input placeholder="Apple ID (email)" value={appleId} onChange={(e) => setAppleId(e.target.value)} />
        <input
          type="password"
          placeholder="App-specific password"
          value={appPassword}
          onChange={(e) => setAppPassword(e.target.value)}
        />
        <div className="row">
          <button onClick={connectICloud}>Connect</button>
          <button onClick={syncICloud}>Sync now</button>
        </div>
        <div className="small">Apple requires an app-specific password for iCloud CardDAV access.</div>
        {error ? <div className="error">{error}</div> : null}
      </div>

      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>
            {calendarMode === "classic"
              ? activeProfile
                ? `${activeProfile.name} Calendar`
                : "Calendar"
              : "All Profiles Ovulation Calendar"}
          </h2>
          <div className="row">
            <button
              onClick={() =>
                setCalendarMode((mode) => (mode === "classic" ? "ovulation-all" : "classic"))
              }
            >
              {calendarMode === "classic" ? "Show Ovulation (All)" : "Show Classic"}
            </button>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              ◀
            </button>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              ▶
            </button>
          </div>
        </div>
        <div>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
        <div className="calendar">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
            <div key={w} className="weekday">
              {w}
            </div>
          ))}
          {monthGrid.map((d) => {
            const dateKey = toISODate(d);
            const dayOvulations = ovulationByDate.get(dateKey) || [];
            const classicTypes = ["period", "ovulation", "fertile"].filter((type) =>
              classicEventMap.has(`${dateKey}:${type}`)
            );
            return (
              <div key={dateKey} className={`day ${d.getMonth() !== month.getMonth() ? "muted" : ""}`}>
                {d.getDate()}
                {calendarMode === "classic"
                  ? classicTypes.map((type) => (
                      <div key={type} className={`event ${type}`}>
                        {type}
                      </div>
                    ))
                  : dayOvulations.map((entry) => (
                      <div key={`${entry.profileId}-${entry.date}`} className="event ovulation">
                        {entry.profileName}
                      </div>
                    ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
