import { useEffect, useMemo, useState } from "react";
import { buildMonthGrid, toISODate } from "./calendar";
import { getPredictedEvents } from "./predictions";

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
      <div className="small">!Profile name from contact list (for example: Sarah Johnson).</div>
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
  const [profiles, setProfiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [calendarMode, setCalendarMode] = useState("classic");
  const [month, setMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [error, setError] = useState("");

  const monthGrid = useMemo(() => buildMonthGrid(month), [month]);
  const from = monthGrid[0];
  const to = monthGrid[monthGrid.length - 1];
  const events = useMemo(
    () => profiles.flatMap((profile) => getPredictedEvents(profile, from, to)),
    [profiles, from, to]
  );

  useEffect(() => {
    const raw = localStorage.getItem("cyclesync.profiles");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setProfiles(parsed);
        if (parsed.length) {
          setActiveProfileId(parsed[0].id);
        }
      }
    } catch (err) {
      setError("Could not read saved profiles from local storage.");
    }
  }, []);

  function persistProfiles(nextProfiles) {
    setProfiles(nextProfiles);
    localStorage.setItem("cyclesync.profiles", JSON.stringify(nextProfiles));
    if (nextProfiles.length === 0) {
      setActiveProfileId(null);
      return;
    }
    if (!nextProfiles.some((p) => p.id === activeProfileId)) {
      setActiveProfileId(nextProfiles[0].id);
    }
  }

  function saveProfile(payload) {
    setError("");
    if (!payload.name) {
      setError("Profile name is required.");
      return;
    }
    if (payload.cycle_length < 20 || payload.cycle_length > 45) {
      setError("Cycle length must be between 20 and 45 days.");
      return;
    }
    if (payload.period_length < 2 || payload.period_length > 10) {
      setError("Period length must be between 2 and 10 days.");
      return;
    }

    const newId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `profile-${Date.now()}`;

    const nextProfiles = editing
      ? profiles.map((p) => (p.id === editing.id ? { ...payload, id: editing.id } : p))
      : [...profiles, { ...payload, id: newId }];

    persistProfiles(nextProfiles);
    setEditing(null);
  }

  function removeProfile(id) {
    setError("");
    const nextProfiles = profiles.filter((p) => p.id !== id);
    persistProfiles(nextProfiles);
    if (activeProfileId === id) {
      setActiveProfileId(nextProfiles[0]?.id || null);
    }
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
        <h2 style={{ margin: 0 }}>CycleSync</h2>
        <div className="small">Profiles are stored locally in your browser.</div>
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
