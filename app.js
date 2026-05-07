const STORAGE_KEY = "householdAssistant.v1";
const GOOGLE_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.readonly openid email profile";
const GOOGLE_LOGIN_SCOPES = "openid email profile";
const googleRuntime = { gapiReady: false, gisReady: false, clientReady: false, tokenClient: null };

const defaultState = {
  activePerson: "partnerA",
  activeUser: "partnerA",
  activeTaskFilter: "open",
  activeChatId: null,
  activeProjectName: null,
  auth: {
    appSignedIn: false,
    googleUser: null,
    localPrototype: false,
    partnerA: { signedIn: true },
    partnerB: { signedIn: false }
  },
  profiles: {
    partnerA: emptyProfile("Rich"),
    partnerB: emptyProfile("Jess")
  },
  tasks: [],
  learnings: [],
  google: {
    connected: false,
    recommendations: [],
    events: [],
    oauth: {
      clientId: "",
      apiKey: "",
      accounts: {
        partnerA: null,
        partnerB: null
      }
    }
  },
  sharedCalendar: {
    imported: false,
    activeView: "shared",
    events: defaultSharedEvents()
  },
  lastOutcome: null
};

let state = loadState();
applyHouseholdUserDefaults();


function applyHouseholdUserDefaults() {
  state.profiles = {
    ...structuredClone(defaultState.profiles),
    ...(state.profiles || {})
  };
  if (!state.profiles.partnerA.name || state.profiles.partnerA.name === "Partner A") state.profiles.partnerA.name = "Rich";
  if (!state.profiles.partnerB.name || state.profiles.partnerB.name === "Partner B") state.profiles.partnerB.name = "Jess";
}

function renderPersonLabels() {
  const nameA = profileName("partnerA");
  const nameB = profileName("partnerB");
  $all('[data-person="partnerA"]').forEach((node) => { node.textContent = nameA; });
  $all('[data-person="partnerB"]').forEach((node) => { node.textContent = nameB; });
  $all('option[value="partnerA"]').forEach((option) => {
    option.textContent = option.closest("#eventCalendar") ? nameA + " calendar" : nameA;
  });
  $all('option[value="partnerB"]').forEach((option) => {
    option.textContent = option.closest("#eventCalendar") ? nameB + " calendar" : nameB;
  });
  $all('option[value="jess"]').forEach((option) => {
    option.textContent = possessiveName(nameB) + " Calendar";
  });
  const copy = {
    "partnerA-calendar": nameA + " calendar",
    "partnerA-proximity": nameA + " proximity",
    "partnerB-calendar": nameB + " calendar",
    "partnerB-proximity": nameB + " proximity"
  };
  $all("[data-person-copy]").forEach((node) => {
    node.textContent = copy[node.dataset.personCopy] || node.textContent;
  });
}
window.gapiLoaded = function gapiLoaded() {
  googleRuntime.gapiReady = true;
  initializeGoogleClient().finally(renderAll);
};

window.gisLoaded = function gisLoaded() {
  googleRuntime.gisReady = true;
  initializeGoogleTokenClient();
  renderAll();
};

async function initializeGoogleClient() {
  if (!window.gapi || !state.google.oauth.apiKey) return false;
  try {
    await new Promise((resolve) => gapi.load("client", resolve));
    await gapi.client.init({
      apiKey: state.google.oauth.apiKey,
      discoveryDocs: [GOOGLE_DISCOVERY_DOC]
    });
    googleRuntime.clientReady = true;
    return true;
  } catch (error) {
    googleRuntime.clientReady = false;
    console.warn("Google Calendar client failed to initialize", error);
    return false;
  }
}

function initializeGoogleTokenClient() {
  if (!window.google || !state.google.oauth.clientId) return false;
  googleRuntime.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: state.google.oauth.clientId,
    scope: GOOGLE_SCOPES,
    callback: ""
  });
  return true;
}

function isAuthenticated() {
  return Boolean(state.auth?.appSignedIn || state.auth?.googleUser || state.auth?.localPrototype);
}

function setLoginStatus(message) {
  const target = $("#loginStatus");
  if (target) target.textContent = message;
}

function renderAuthGate() {
  const signedIn = isAuthenticated();
  document.body.classList.toggle("auth-locked", !signedIn);
  const loginScreen = $("#loginScreen");
  if (loginScreen) loginScreen.hidden = signedIn;
  const clientInput = $("#loginGoogleClientId");
  if (clientInput && document.activeElement !== clientInput) clientInput.value = state.google?.oauth?.clientId || "";
  const signOut = $("#signOutButton");
  if (signOut) {
    const label = state.auth?.googleUser?.email ? `Sign out ${state.auth.googleUser.email}` : "Sign out";
    signOut.textContent = label;
  }
}

function requestGoogleLoginToken() {
  return new Promise((resolve, reject) => {
    if (!window.google || !state.google.oauth.clientId) {
      reject(new Error("Google sign-in is not ready yet."));
      return;
    }
    const loginClient = google.accounts.oauth2.initTokenClient({
      client_id: state.google.oauth.clientId,
      scope: GOOGLE_LOGIN_SCOPES,
      callback: (response) => {
        if (response.error) {
          reject(response);
          return;
        }
        resolve(response.access_token);
      }
    });
    loginClient.requestAccessToken({ prompt: "consent" });
  });
}

async function signInWithGoogle() {
  const clientInput = $("#loginGoogleClientId");
  const clientId = (clientInput?.value || state.google?.oauth?.clientId || "").trim();
  if (!clientId) {
    setLoginStatus("Paste your Google OAuth Client ID first. You can create it in Google Cloud for this local app URL.");
    return;
  }
  state.google.oauth.clientId = clientId;
  saveState();

  if (!window.google) {
    setLoginStatus("Google sign-in is still loading. Try again in a moment.");
    return;
  }

  setLoginStatus("Opening Google sign-in...");
  try {
    const accessToken = await requestGoogleLoginToken();
    const profile = await fetchGoogleProfile(accessToken);
    const now = new Date().toISOString();
    state.auth = {
      ...state.auth,
      appSignedIn: true,
      localPrototype: false,
      googleUser: {
        email: profile?.email || "Google Workspace user",
        name: profile?.name || profileName("partnerA"),
        signedInAt: now
      },
      partnerA: { signedIn: true, signedInAt: now },
      partnerB: state.auth?.partnerB || { signedIn: false }
    };
    state.google.oauth.accounts.partnerA = {
      ...(state.google.oauth.accounts.partnerA || {}),
      email: profile?.email || state.google.oauth.accounts.partnerA?.email || "",
      name: profile?.name || profileName("partnerA")
    };
    state.activeUser = "partnerA";
    initializeGoogleTokenClient();
    saveState();
    renderAll();
    showView("chat");
    toast("Signed in with Google Workspace.");
  } catch (error) {
    console.warn("Google sign-in failed", error);
    setLoginStatus("Google sign-in did not complete. Check the OAuth Client ID and authorized origin, then try again.");
  }
}

function signInLocalPrototype() {
  const now = new Date().toISOString();
  state.auth = {
    ...state.auth,
    appSignedIn: true,
    localPrototype: true,
    googleUser: null,
    partnerA: { signedIn: true, signedInAt: now },
    partnerB: state.auth?.partnerB || { signedIn: false }
  };
  state.activeUser = "partnerA";
  saveState();
  renderAll();
  showView("chat");
  toast("Local prototype mode enabled.");
}

function signOut() {
  state.auth = {
    ...state.auth,
    appSignedIn: false,
    localPrototype: false,
    googleUser: null,
    partnerA: { signedIn: false },
    partnerB: { signedIn: false }
  };
  state.activeUser = "partnerA";
  saveState();
  renderAll();
  setLoginStatus("Signed out. Sign in with Google Workspace to continue.");
}

async function prepareGoogleCalendarApi() {
  if (!state.google.oauth.clientId || !state.google.oauth.apiKey) {
    toast("Add your Google Client ID and API key in Settings > Google.");
    showView("integrations");
    return false;
  }
  if (!googleRuntime.clientReady) await initializeGoogleClient();
  if (!googleRuntime.tokenClient) initializeGoogleTokenClient();
  if (!googleRuntime.clientReady || !googleRuntime.tokenClient) {
    toast("Google libraries are still loading. Try again in a moment.");
    return false;
  }
  return true;
}

function requestGoogleAccessToken(person) {
  return new Promise((resolve, reject) => {
    googleRuntime.tokenClient.callback = (response) => {
      if (response.error) {
        reject(response);
        return;
      }
      resolve(response.access_token);
    };
    googleRuntime.tokenClient.requestAccessToken({ prompt: "consent", hint: state.google.oauth.accounts[person]?.email || "" });
  });
}

async function fetchGoogleProfile(accessToken) {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function connectGoogleCalendar(person) {
  if (!await prepareGoogleCalendarApi()) return;
  try {
    const accessToken = await requestGoogleAccessToken(person);
    const profile = await fetchGoogleProfile(accessToken);
    const imported = await importGoogleCalendarForPerson(person, accessToken, profile);
    state.google.oauth.accounts[person] = {
      email: profile?.email || state.google.oauth.accounts[person]?.email || profileName(person),
      name: profile?.name || profileName(person),
      importedAt: new Date().toISOString(),
      count: imported.length
    };
    state.google.connected = true;
    mergeImportedGoogleEvents();
    ensureCalendarAgentChat().messages.push({
      role: "assistant",
      text: `${profileName(person)} connected Google Calendar and imported ${imported.length} upcoming events.`
    });
    saveState();
    renderAll();
    toast(`${profileName(person)} calendar imported.`);
  } catch (error) {
    console.warn("Google Calendar import failed", error);
    toast("Google Calendar import did not complete.");
  }
}

async function importGoogleCalendarForPerson(person, accessToken, profile) {
  gapi.client.setToken({ access_token: accessToken });
  const response = await gapi.client.calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    timeMax: addDays(todayISO(), 45) + "T23:59:59Z",
    showDeleted: false,
    singleEvents: true,
    maxResults: 30,
    orderBy: "startTime"
  });
  const imported = (response.result.items || []).map((event) => normalizeGoogleEvent(event, person, profile));
  state.google.events = [
    ...state.google.events.filter((event) => event.source !== "google-import" || event.importedFor !== person),
    ...imported
  ];
  return imported;
}

function normalizeGoogleEvent(event, person, profile) {
  const start = event.start?.dateTime || event.start?.date || "";
  const end = event.end?.dateTime || event.end?.date || "";
  const date = start.slice(0, 10) || todayISO();
  const time = start.includes("T") ? start.slice(11, 16) : "All day";
  const endTime = end.includes("T") ? end.slice(11, 16) : "";
  return {
    id: `google-${person}-${event.id}`,
    googleId: event.id,
    iCalUID: event.iCalUID || event.id,
    title: event.summary || "Untitled event",
    calendar: person,
    importedFor: person,
    importedByEmail: profile?.email || "",
    start,
    end,
    date,
    time,
    endTime,
    location: event.location || "Location needed",
    notes: event.description || "",
    status: "imported",
    source: "google-import",
    attendees: (event.attendees || []).map((attendee) => attendee.email).filter(Boolean),
    createdAt: new Date().toISOString()
  };
}

function mergeImportedGoogleEvents() {
  const imported = state.google.events.filter((event) => event.source === "google-import");
  if (!imported.length) return;
  const accounts = state.google.oauth.accounts || {};
  const emailA = accounts.partnerA?.email || "";
  const emailB = accounts.partnerB?.email || "";
  const groups = new Map();
  imported.forEach((event) => {
    const key = event.iCalUID || `${event.title}-${event.start}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  const sharedEvents = Array.from(groups.values())
    .filter((events) => {
      const owners = new Set(events.map((event) => event.importedFor));
      const attendees = new Set(events.flatMap((event) => event.attendees || []));
      return owners.size > 1 || (emailA && attendees.has(emailA) && emailB && attendees.has(emailB));
    })
    .map((events) => normalizeImportedSharedEvent(events));
  if (sharedEvents.length) {
    state.sharedCalendar.imported = true;
    state.sharedCalendar.events = sharedEvents;
  }
}

function normalizeImportedSharedEvent(events) {
  const event = events[0];
  const category = inferCalendarCategory(event);
  return normalizeSharedEvent({
    id: `shared-google-${event.iCalUID || event.googleId}`,
    title: event.title,
    date: event.date,
    time: event.time,
    endTime: event.endTime,
    location: event.location || "Location needed",
    address: event.location || "Address needed",
    category,
    availability: { partnerA: "free", partnerB: "free" },
    proximity: { partnerA: 15, partnerB: 15 },
    suggestedTasks: suggestedTasksForImportedEvent(event, category)
  });
}

function inferCalendarCategory(event) {
  const text = `${event.title} ${event.location} ${event.notes}`.toLowerCase();
  if (text.includes("wedding") || text.includes("venue") || text.includes("vendor")) return "Wedding";
  if (text.includes("school") || text.includes("kid") || text.includes("family")) return "Family";
  if (text.includes("doctor") || text.includes("dentist") || text.includes("health")) return "Health";
  if (text.includes("meeting") || text.includes("client") || text.includes("business")) return "Business";
  return "Admin";
}

function suggestedTasksForImportedEvent(event, category) {
  const base = [
    { title: `Confirm details for ${event.title}`, owner: "both", success: "Location, time, and prep notes are confirmed." },
    { title: `Prepare for ${event.title}`, owner: "both", success: "Needed materials, questions, or handoffs are ready before the event." }
  ];
  if (category === "Wedding") base.push({ title: `Capture decisions from ${event.title}`, owner: "partnerA", success: "Decisions and follow-ups are written into the project chat." });
  if (category === "Family") base.push({ title: `Handle logistics for ${event.title}`, owner: "partnerB", success: "Pickup, travel, food, or supplies are covered." });
  return base;
}
function emptyProfile(name) {
  return {
    name,
    planningStyle: "clear steps",
    accountabilityTone: "warm and direct",
    conflictPattern: "solve quickly",
    repairAttempts: "",
    values: "",
    fairness: "",
    avoid: "",
    energy: "3",
    notice: "3"
  };
}

function defaultSharedEvents() {
  return [
    {
      id: "shared-venue-tour",
      title: "Venue tour",
      date: addDays(todayISO(), 3),
      time: "16:00",
      endTime: "17:00",
      location: "Downtown venue",
      address: "Downtown venue district",
      category: "Wedding",
      availability: { partnerA: "soft", partnerB: "free" },
      proximity: { partnerA: 18, partnerB: 8 },
      suggestedTasks: [
        { title: "Confirm parking and arrival instructions", owner: "partnerB", success: "Venue confirms parking, entrance, and arrival time." },
        { title: "Prepare venue questions", owner: "partnerA", success: "Top questions are written before the tour." },
        { title: "Add tour details to shared calendar", owner: "both", success: "Calendar event has location, notes, and travel buffer." }
      ]
    },
    {
      id: "shared-family-dinner",
      title: "Family dinner",
      date: addDays(todayISO(), 5),
      time: "18:30",
      endTime: "20:00",
      location: "Parents' house",
      address: "Family home",
      category: "Family",
      availability: { partnerA: "free", partnerB: "soft" },
      proximity: { partnerA: 12, partnerB: 24 },
      suggestedTasks: [
        { title: "Pick up dessert", owner: "partnerA", success: "Dessert is picked up before dinner." },
        { title: "Confirm who is attending", owner: "partnerB", success: "Final headcount is confirmed." }
      ]
    },
    {
      id: "shared-kids-pickup",
      title: "School pickup window",
      date: addDays(todayISO(), 1),
      time: "15:30",
      endTime: "16:00",
      location: "School",
      address: "School pickup lane",
      category: "Family",
      availability: { partnerA: "busy", partnerB: "free" },
      proximity: { partnerA: 28, partnerB: 9 },
      suggestedTasks: [
        { title: "Handle pickup", owner: "partnerB", success: "Kids are picked up during the pickup window." },
        { title: "Send pickup note", owner: "partnerA", success: "The pickup plan is confirmed in the family thread." }
      ]
    }
  ];
}

function normalizeSharedEvent(event) {
  return {
    id: event.id || id(),
    title: event.title || "Shared event",
    date: event.date || todayISO(),
    time: event.time || "09:00",
    endTime: event.endTime || "09:30",
    location: event.location || "Location needed",
    address: event.address || event.location || "Address needed",
    category: event.category || "Admin",
    availability: {
      partnerA: event.availability && event.availability.partnerA ? event.availability.partnerA : "free",
      partnerB: event.availability && event.availability.partnerB ? event.availability.partnerB : "free"
    },
    proximity: {
      partnerA: Number(event.proximity && event.proximity.partnerA !== undefined ? event.proximity.partnerA : 15),
      partnerB: Number(event.proximity && event.proximity.partnerB !== undefined ? event.proximity.partnerB : 20)
    },
    suggestedTasks: Array.isArray(event.suggestedTasks) && event.suggestedTasks.length
      ? event.suggestedTasks
      : [{ title: "Prepare for " + (event.title || "shared event"), owner: "both", success: "Prep is complete before the event." }]
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const merged = saved
      ? {
          ...structuredClone(defaultState),
          ...saved,
          profiles: {
            ...structuredClone(defaultState.profiles),
            ...(saved.profiles || {})
          },
          auth: {
            ...structuredClone(defaultState.auth),
            ...(saved.auth || {})
          },
          google: {
            ...structuredClone(defaultState.google),
            ...(saved.google || {}),
            oauth: {
              ...structuredClone(defaultState.google.oauth),
              ...(saved.google?.oauth || {}),
              accounts: {
                ...structuredClone(defaultState.google.oauth.accounts),
                ...(saved.google?.oauth?.accounts || {})
              }
            }
          },
          sharedCalendar: {
            ...structuredClone(defaultState.sharedCalendar),
            ...(saved.sharedCalendar || {})
          }
        }
      : structuredClone(defaultState);

    if (!["mine", "jess", "shared"].includes(merged.sharedCalendar.activeView)) merged.sharedCalendar.activeView = "shared";
    merged.sharedCalendar.events = (merged.sharedCalendar.events && merged.sharedCalendar.events.length ? merged.sharedCalendar.events : defaultSharedEvents()).map(normalizeSharedEvent);
    merged.tasks = (merged.tasks || []).map(normalizeTask);
    if (!["partnerA", "partnerB"].includes(merged.activeUser)) merged.activeUser = "partnerA";
    if (!merged.activeChatId && merged.tasks.length) merged.activeChatId = merged.tasks[0].id;
    return merged;
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeTask(task) {
  const participants = Array.isArray(task.participants) && task.participants.length
    ? task.participants.filter((person) => ["partnerA", "partnerB"].includes(person))
    : ["partnerA", "partnerB"];
  const normalized = {
    ...task,
    id: task.id || id(),
    title: task.title || "Untitled task",
    owner: task.owner || "both",
    due: task.due || "",
    category: task.category || "Admin",
    success: task.success || "",
    why: task.why || "",
    notes: task.notes || "",
    recurrence: task.recurrence || "none",
    status: task.status || "open",
    createdAt: task.createdAt || new Date().toISOString(),
    updates: task.updates || [],
    accountabilityPath: task.accountabilityPath || "email",
    accountabilityGraceDays: Number(task.accountabilityGraceDays ?? 0),
    accountabilityLog: task.accountabilityLog || [],
    accountabilityState: task.accountabilityState || "not-started",
    participants: participants.length ? [...new Set(participants)] : ["partnerA", "partnerB"],
    project: task.project || "",
    calendarAgent: Boolean(task.calendarAgent)
  };
  normalized.chatTitle = task.chatTitle || task.title || "Untitled chat";
  normalized.agentName = task.agentName || defaultAgentName(normalized.category);
  normalized.messages = Array.isArray(task.messages) && task.messages.length
    ? task.messages
    : initialMessages(normalized);
  return normalized;
}

function defaultAgentName(category) {
  const agents = {
    Home: "Home Operations Agent",
    Family: "Family Logistics Agent",
    Money: "Household Finance Agent",
    Health: "Health Admin Agent",
    Relationship: "Relationship Accountability Agent",
    Admin: "Executive Admin Agent",
    Business: "Business Operations Agent",
    Wedding: "Wedding Planning Agent"
  };
  return agents[category] || "Executive Assistant Agent";
}

function initialMessages(task) {
  return [
    {
      role: "assistant",
      text: `I am the ${task.agentName || defaultAgentName(task.category)} for "${task.chatTitle || task.title}". I will keep the owner clear, track the next action, and suggest balanced next steps instead of vague reminders.`
    }
  ];
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "No due date";
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function profileName(person) {
  if (person === "both") return "Both";
  return state.profiles[person]?.name || (person === "partnerA" ? "Rich" : "Jess");
}

function possessiveName(name) {
  const value = String(name || "").trim();
  if (!value) return "Partner's";
  return value.endsWith("s") ? value + "'" : value + "'s";
}

function chatParticipants(task) {
  const participants = Array.isArray(task?.participants) && task.participants.length
    ? task.participants
    : ["partnerA", "partnerB"];
  const valid = participants.filter((person) => ["partnerA", "partnerB"].includes(person));
  return valid.length ? [...new Set(valid)] : ["partnerA", "partnerB"];
}

function initials(name) {
  const letters = String(name || "")
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2);
  return letters.toUpperCase() || "U";
}

function messageAuthorName(message, task) {
  if (message.role === "assistant") return task?.agentName || "AI";
  return profileName(message.author || "partnerA");
}

function messageAvatar(message, task) {
  return message.role === "assistant" ? "AI" : initials(messageAuthorName(message, task));
}

function loginStateLabel(person) {
  return state.auth?.[person]?.signedIn ? "Signed in" : "Sign in";
}

function splitList(value) {
  return String(value || "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function id() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function init() {
  bindAuth();
  bindNavigation();
  bindMobileShell();
  bindChat();
  bindSearch();
  bindProfiles();
  bindTasks();
  bindPlanning();
  bindIntegrations();
  bindDashboardCalendar();
  bindMobile();
  bindLearning();
  bindDemo();
  ensureCalendarAgentChat();
  saveState();
  registerMobileRuntime();
  setDefaultDates();
  renderAll();
  routeFromHash();
}


function bindAuth() {
  const loginForm = $("#loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      signInWithGoogle();
    });
  }
  const localButton = $("#localPrototypeLogin");
  if (localButton) localButton.addEventListener("click", signInLocalPrototype);
  const signOutButton = $("#signOutButton");
  if (signOutButton) signOutButton.addEventListener("click", signOut);
}

function ensureExecutiveAssistantChat() {
  let chat = state.tasks.find((task) => task.homeAgent)
    || state.tasks.find((task) => task.agentName === "Executive Assistant Agent" && task.chatTitle === "Executive Assistant");

  if (!chat) {
    chat = normalizeTask({
      id: id(),
      title: "Executive Assistant",
      chatTitle: "Executive Assistant",
      agentName: "Executive Assistant Agent",
      owner: "both",
      due: todayISO(),
      category: "Admin",
      accountabilityPath: "all",
      accountabilityGraceDays: 0,
      success: "The next useful task, project, calendar action, or household decision is clearly captured.",
      why: "CoupleOS should open directly into a useful assistant chat.",
      project: "",
      status: "open",
      homeAgent: true,
      createdAt: new Date().toISOString(),
      updates: [],
      messages: [
        { role: "assistant", text: "What should we handle first? I can turn a message into a task, project, calendar action, grocery list, or shared plan." }
      ]
    });
    state.tasks.unshift(chat);
  }

  return chat;
}

function ensureCalendarAgentChat() {
  let agent = state.tasks.find((task) => task.calendarAgent)
    || state.tasks.find((task) => task.agentName === "Google Calendar Agent" && task.chatTitle === "Shared Calendar");

  if (!agent) {
    agent = normalizeTask({
      id: id(),
      title: "Shared Google Calendar",
      chatTitle: "Shared Calendar",
      agentName: "Google Calendar Agent",
      owner: "both",
      due: "",
      category: "Admin",
      accountabilityPath: "all",
      accountabilityGraceDays: 0,
      success: "Shared calendar events are reviewed and converted into tasks or projects when needed.",
      why: "This is the recurring calendar command center for the couple.",
      project: "Google Calendar",
      calendarAgent: true,
      status: "open",
      createdAt: new Date().toISOString(),
      updates: [],
      messages: [
        { role: "assistant", text: "I am the shared Google Calendar Agent. Bring me calendar imports, upcoming events, addresses, and handoff questions. I will recommend owners, start small tasks, and promote bigger work into Project chats only when you choose it." }
      ]
    });
    state.tasks.unshift(agent);
  }

  agent.calendarAgent = true;
  agent.agentName = "Google Calendar Agent";
  agent.chatTitle = agent.chatTitle || "Shared Calendar";
  agent.participants = ["partnerA", "partnerB"];

  state.tasks.forEach((task) => {
    if (task !== agent && task.agentName === "Google Calendar Agent") task.agentName = "Calendar Task Agent";
  });

  return agent;
}

function bindDashboardCalendar() {
  const importButton = $("#importSharedCalendar");
  if (importButton) {
    importButton.addEventListener("click", () => {
      showView("integrations");
      toast(hasGoogleSetup() ? "Choose which partner calendar to import." : "Add Google API setup first.");
    });
  }

  const openAgentButton = $("#openCalendarAgent");
  if (openAgentButton) {
    openAgentButton.addEventListener("click", () => {
      const agent = ensureCalendarAgentChat();
      state.activeChatId = agent.id;
      saveState();
      renderAll();
      showView("chat");
      toast("Calendar Agent opened.");
    });
  }

  const viewSelect = $("#calendarViewSelect");
  if (viewSelect) {
    viewSelect.addEventListener("change", () => {
      state.sharedCalendar.activeView = viewSelect.value;
      saveState();
      renderDashboardCalendar();
    });
  }

  const eventList = $("#sharedEventList");
  if (eventList) {
    eventList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-calendar-action]");
      if (!button) return;
      const action = button.dataset.calendarAction;
      if (action === "open-agent") {
        state.activeChatId = ensureCalendarAgentChat().id;
      }
      const calendarEvent = state.sharedCalendar.events.find((item) => item.id === button.dataset.eventId);
      if (!calendarEvent) {
        saveState();
        renderAll();
        showView("chat");
        return;
      }
      if (action === "recommend") addCalendarAgentRecommendation(calendarEvent);
      if (action === "task") createTaskFromSharedEvent(calendarEvent, Number(button.dataset.suggestionIndex || 0));
      if (action === "project") createProjectFromSharedEvent(calendarEvent);
      saveState();
      renderAll();
      showView(action === "project" ? "projects" : "chat");
    });
  }
}

function recommendSharedEventOwner(calendarEvent) {
  const a = scoreCalendarPerson("partnerA", calendarEvent.availability.partnerA, calendarEvent.proximity.partnerA);
  const b = scoreCalendarPerson("partnerB", calendarEvent.availability.partnerB, calendarEvent.proximity.partnerB);
  const winner = a.score <= b.score ? a : b;
  const backup = winner.person === "partnerA" ? b : a;
  return {
    owner: winner.person,
    ownerName: profileName(winner.person),
    backupName: profileName(backup.person),
    reason: profileName(winner.person) + " is " + winner.statusLabel.toLowerCase() + " and about " + winner.minutes + " minutes away; " + profileName(backup.person) + " is " + backup.statusLabel.toLowerCase() + " and about " + backup.minutes + " minutes away."
  };
}

function addCalendarAgentRecommendation(calendarEvent) {
  const recommendation = recommendSharedEventOwner(calendarEvent);
  const agent = ensureCalendarAgentChat();
  agent.messages.push({
    role: "assistant",
    text: "For \"" + calendarEvent.title + "\", I would have " + recommendation.ownerName + " take the first handoff. " + recommendation.reason + " Backup: " + recommendation.backupName + "."
  });
  toast("Recommendation added to the Calendar Agent chat.");
}

function createTaskFromSharedEvent(calendarEvent, suggestionIndex) {
  const suggestion = calendarEvent.suggestedTasks[suggestionIndex] || calendarEvent.suggestedTasks[0];
  const recommendation = recommendSharedEventOwner(calendarEvent);
  const owner = suggestion.owner || recommendation.owner;
  const task = normalizeTask({
    id: id(),
    title: suggestion.title,
    chatTitle: suggestion.title,
    agentName: defaultAgentName(calendarEvent.category),
    owner,
    due: calendarEvent.date,
    category: calendarEvent.category,
    accountabilityPath: "all",
    accountabilityGraceDays: 0,
    success: suggestion.success || "Ready before " + calendarEvent.title + ".",
    why: "Created from shared calendar event: " + calendarEvent.title + " at " + calendarEvent.location + ". " + recommendation.reason,
    project: "",
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      { role: "assistant", text: "Created from the shared calendar event \"" + calendarEvent.title + "\". Recommended owner: " + profileName(owner) + "." },
      { role: "assistant", text: "Event: " + calendarEvent.date + " at " + calendarEvent.time + ". Location: " + calendarEvent.location + "." }
    ]
  });
  state.tasks.unshift(task);
  state.activeChatId = ensureCalendarAgentChat().id;
  ensureCalendarAgentChat().messages.push({
    role: "assistant",
    text: "Started task \"" + task.title + "\" for " + profileName(owner) + " from \"" + calendarEvent.title + "\". I kept the task in its own chat and left this calendar thread as the shared command center."
  });
  toast("Task created from calendar event.");
}

function createProjectFromSharedEvent(calendarEvent) {
  const projectName = calendarEvent.title;
  const recommendation = recommendSharedEventOwner(calendarEvent);
  const projectChat = normalizeTask({
    id: id(),
    title: projectName + ": project plan",
    chatTitle: projectName,
    agentName: "Project Planning Agent",
    owner: "both",
    due: calendarEvent.date,
    category: calendarEvent.category,
    accountabilityPath: "all",
    accountabilityGraceDays: 1,
    success: "Project plan and subtasks for " + projectName + " are complete before the shared event.",
    why: "Promoted from the shared Google Calendar because this event needs multiple steps. " + recommendation.reason,
    project: projectName,
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      { role: "assistant", text: "This is the Project chat for \"" + projectName + "\". I will coordinate subtasks, decisions, owners, and the deadline from the calendar event." },
      { role: "assistant", text: "Calendar anchor: " + calendarEvent.date + " " + calendarEvent.time + " at " + calendarEvent.location + "." }
    ]
  });
  const subtasks = calendarEvent.suggestedTasks.map((suggestion) => normalizeTask({
    id: id(),
    title: projectName + ": " + suggestion.title,
    chatTitle: suggestion.title,
    agentName: defaultAgentName(calendarEvent.category),
    owner: suggestion.owner || recommendation.owner,
    due: calendarEvent.date,
    category: calendarEvent.category,
    accountabilityPath: "all",
    accountabilityGraceDays: 0,
    success: suggestion.success || "Done before " + projectName + ".",
    why: "Subtask for " + projectName + ".",
    project: projectName,
    status: "open",
    createdAt: new Date().toISOString(),
    updates: []
  }));
  state.tasks = [projectChat, ...subtasks, ...state.tasks];
  state.activeProjectName = projectName;
  state.activeChatId = projectChat.id;
  ensureCalendarAgentChat().messages.push({
    role: "assistant",
    text: "Promoted \"" + projectName + "\" into a Project chat with " + subtasks.length + " subtasks. I will keep this calendar thread focused on imports and event triage."
  });
  toast("Project chat created from calendar event.");
}

function bindMobile() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mobile-action]");
    if (!button) return;
    if (button.dataset.mobileAction === "install" && window.deferredInstallPrompt) {
      window.deferredInstallPrompt.prompt();
      window.deferredInstallPrompt.userChoice.finally(() => {
        window.deferredInstallPrompt = null;
        renderMobileStatus();
      });
    }
  });
}

function bindMobileShell() {
  const openTargets = ["#mobileMenuButton"];
  const closeTargets = ["#mobileBackdrop"];

  openTargets.forEach((selector) => {
    const target = $(selector);
    if (!target) return;
    ["click", "pointerup", "touchend"].forEach((type) => {
      target.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        openMobileMenu();
      }, { passive: false });
    });
  });

  closeTargets.forEach((selector) => {
    const target = $(selector);
    if (!target) return;
    ["click", "pointerup", "touchend"].forEach((type) => {
      target.addEventListener(type, (event) => {
        event.preventDefault();
        closeMobileMenu();
      }, { passive: false });
    });
  });

  $("#mobileNewChat")?.addEventListener("click", createQuickChat);

  document.addEventListener("click", (event) => {
    if (event.target.closest("#mobileMenuButton")) {
      openMobileMenu();
      return;
    }
    if (event.target.closest("#mobileBackdrop")) closeMobileMenu();
  });
}
function bindNavigation() {
  $("#quickNewChat").addEventListener("click", createQuickChat);
  $all("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.view);
      closeMobileMenu();
    });
  });
  $all("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.jump);
      closeMobileMenu();
    });
  });
}

function openMobileMenu() {
  document.body.classList.add("mobile-menu-open");
  $("#mobileMenuButton")?.setAttribute("aria-expanded", "true");
}

function closeMobileMenu() {
  document.body.classList.remove("mobile-menu-open");
  $("#mobileMenuButton")?.setAttribute("aria-expanded", "false");
}

function showView(view) {
  if (!$(`#${view}`)) view = "chat";
  $all(".view").forEach((section) => section.classList.toggle("active", section.id === view));
  const settingsViews = ["settings", "onboarding", "learning", "integrations", "mobile"];
  const activeNav = settingsViews.includes(view) ? "settings" : view;
  $all(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === activeNav));
  if (view === "chat") {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  } else if (location.hash !== `#${view}`) {
    history.replaceState(null, "", `#${view}`);
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileMenu();
});

function routeFromHash() {
  const view = location.hash.replace("#", "");
  if (view && view !== "dashboard" && $(`#${view}`)) showView(view);
  else showView("chat");
}

function activeTask() {
  return state.tasks.find((task) => task.id === state.activeChatId) || null;
}

function createQuickChat() {
  const task = normalizeTask({
    id: id(),
    title: "New chat",
    chatTitle: "New chat",
    agentName: "Executive Assistant Agent",
    owner: "both",
    due: "",
    category: "Admin",
    accountabilityPath: "email",
    accountabilityGraceDays: 0,
    success: "",
    why: "Open-ended AI assistance.",
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      {
        role: "assistant",
        text: "What are we creating or coordinating? I can turn this into a task, a reminder, or a calendar event once you give me the shape."
      }
    ]
  });
  state.tasks.unshift(task);
  state.activeChatId = task.id;
  saveState();
  renderAll();
  showView("chat");
  toast("New chat created.");
}

function bindChat() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-login-user]");
    if (!button) return;
    const person = button.dataset.loginUser;
    if (!["partnerA", "partnerB"].includes(person)) return;
    state.activeUser = person;
    state.auth = {
      ...state.auth,
      [person]: { signedIn: true, signedInAt: new Date().toISOString() }
    };
    saveState();
    renderAll();
    toast(`${profileName(person)} signed in.`);
  });

  $("#chatList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-chat-id]");
    if (!button) return;
    state.activeChatId = button.dataset.chatId;
    saveState();
    showView("chat");
    renderAll();
  });

  $("#renameChatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const task = activeTask();
    if (!task) return;
    task.chatTitle = $("#chatNameInput").value.trim() || task.chatTitle;
    task.agentName = $("#agentNameInput").value.trim() || task.agentName;
    task.messages.push({
      role: "assistant",
      text: `Renamed this workspace to "${task.chatTitle}" and assigned ${task.agentName} to support it.`
    });
    saveState();
    renderAll();
    toast("Chat updated.");
  });

  $("#chatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const task = activeTask();
    const input = $("#chatInput");
    const text = input.value.trim();
    if (!task || !text) return;
    task.messages.push({ role: "user", author: state.activeUser, text });
    const placeholder = { role: "assistant", text: "Thinking..." };
    task.messages.push(placeholder);
    input.value = "";
    saveState();
    renderAll();

    try {
      const result = await requestOpenAIChat(task, text);
      placeholder.text = result.message || "Done.";
      applyOpenAIActions(result.actions || [], task);
      if (result.configured === false) toast("OpenAI setup needed.");
    } catch (error) {
      console.warn("OpenAI chat failed; using local prototype reply", error);
      placeholder.text = buildAgentReply(task, text);
      toast("Using local prototype reply.");
    }

    saveState();
    renderAll();
  });

  $("#starterPrompts").addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt]");
    if (!button) return;
    $("#chatInput").value = button.dataset.prompt;
    $("#chatForm").requestSubmit();
  });
}

function bindSearch() {
  $("#globalSearchInput").addEventListener("input", renderSearch);
  $("#searchResults").addEventListener("click", (event) => {
    const button = event.target.closest("[data-search-chat]");
    if (!button) return;
    state.activeChatId = button.dataset.searchChat;
    saveState();
    renderAll();
    showView("chat");
  });
}

async function requestOpenAIChat(task, text) {
  if (window.location.protocol === "file:") {
    return {
      configured: false,
      actions: [],
      message: "OpenAI chat needs the local server URL, not the file URL. Start the CoupleOS server with OPENAI_API_KEY, then open http://localhost:5173 or your phone testing URL."
    };
  }

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: text,
      context: buildOpenAIContext(task)
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !body.message) throw new Error("OpenAI chat request failed.");
  return body;
}

function buildOpenAIContext(task) {
  return {
    today: todayISO(),
    activeUser: state.activeUser,
    activeUserName: profileName(state.activeUser),
    profiles: {
      partnerA: publicProfileForAI("partnerA"),
      partnerB: publicProfileForAI("partnerB")
    },
    activeChat: summarizeTaskForAI(task),
    recentMessages: task.messages
      .filter((message) => message.text !== "Thinking...")
      .slice(-12)
      .map((message) => ({
        role: message.role,
        author: message.author ? profileName(message.author) : "assistant",
        text: message.text
      })),
    tasks: state.tasks.slice(0, 20).map(summarizeTaskForAI),
    calendarDrafts: state.google.events.slice(0, 12).map((event) => ({
      id: event.id,
      title: event.title,
      calendar: event.calendar,
      start: event.start,
      end: event.end,
      location: event.location,
      notes: event.notes,
      status: event.status
    })),
    sharedEvents: state.sharedCalendar.events.slice(0, 10).map((event) => ({
      id: event.id,
      title: event.title,
      date: event.date,
      time: event.time,
      location: event.location,
      category: event.category,
      suggestedTasks: event.suggestedTasks
    }))
  };
}

function publicProfileForAI(person) {
  const profile = state.profiles[person] || {};
  return {
    name: profileName(person),
    planningStyle: profile.planningStyle,
    accountabilityTone: profile.accountabilityTone,
    conflictPattern: profile.conflictPattern,
    values: profile.values,
    fairness: profile.fairness,
    avoid: profile.avoid,
    energy: profile.energy,
    notice: profile.notice
  };
}

function summarizeTaskForAI(task) {
  return {
    id: task.id,
    title: task.title,
    chatTitle: task.chatTitle,
    agentName: task.agentName,
    owner: task.owner,
    ownerName: profileName(task.owner),
    due: task.due,
    category: task.category,
    project: task.project,
    status: task.status,
    success: task.success,
    notes: task.notes,
    recurrence: task.recurrence,
    participants: chatParticipants(task).map(profileName)
  };
}

function applyOpenAIActions(actions, sourceTask) {
  const applied = [];
  actions.forEach((action) => {
    const payload = action.payload || {};
    if (action.type === "create_task") applied.push(applyCreateTaskAction(payload));
    if (action.type === "create_project") applied.push(applyCreateProjectAction(payload));
    if (action.type === "draft_calendar_event") applied.push(applyDraftCalendarEventAction(payload));
    if (action.type === "update_calendar_event") applied.push(applyUpdateCalendarEventAction(payload));
  });
  const count = applied.filter(Boolean).length;
  if (count) toast(count + " AI action" + (count === 1 ? "" : "s") + " applied.");
}

function normalizeActionOwner(owner) {
  return ["partnerA", "partnerB", "both"].includes(owner) ? owner : "both";
}

function normalizeActionCategory(category) {
  const categories = ["Home", "Family", "Money", "Health", "Relationship", "Admin", "Business", "Wedding"];
  return categories.includes(category) ? category : "Admin";
}

function applyCreateTaskAction(payload) {
  const category = normalizeActionCategory(payload.category);
  const title = payload.title || "New task";
  const task = normalizeTask({
    id: id(),
    title,
    chatTitle: payload.chatTitle || title,
    agentName: payload.agentName || defaultAgentName(category),
    owner: normalizeActionOwner(payload.owner),
    due: payload.due || "",
    category,
    accountabilityPath: "all",
    accountabilityGraceDays: 0,
    success: payload.success || title,
    why: "Created by the OpenAI agent.",
    notes: payload.notes || "",
    project: payload.project || "",
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      { role: "assistant", text: "Created by the OpenAI agent from chat." }
    ]
  });
  state.tasks.unshift(task);
  state.activeChatId = task.id;
  return task.id;
}

function applyCreateProjectAction(payload) {
  const category = normalizeActionCategory(payload.category);
  const projectName = payload.name || "New Project";
  const due = payload.due || "";
  const recurrence = normalizeRecurrence(payload.recurrence);
  const projectChat = normalizeTask({
    id: id(),
    title: projectName + ": project plan",
    chatTitle: projectName,
    agentName: "Project Planning Agent",
    owner: normalizeActionOwner(payload.owner),
    due,
    category,
    accountabilityPath: "all",
    accountabilityGraceDays: 1,
    success: payload.summary || "Project plan is clear and ready to act on.",
    why: "Created by the OpenAI agent.",
    notes: payload.summary || "",
    recurrence,
    project: projectName,
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      { role: "assistant", text: payload.summary || "This project was created by the OpenAI agent from chat." },
      { role: "assistant", text: projectRecommendationText(projectName, payload.summary || "", recurrence) }
    ]
  });
  const subtasks = Array.isArray(payload.subtasks) ? payload.subtasks.map((item) => {
    const subCategory = normalizeActionCategory(item.category || category);
    const title = item.title || "Project task";
    return normalizeTask({
      id: id(),
      title: projectName + ": " + title,
      chatTitle: title,
      agentName: defaultAgentName(subCategory),
      owner: normalizeActionOwner(item.owner),
      due: item.due || due,
      category: subCategory,
      accountabilityPath: "all",
      accountabilityGraceDays: 0,
      success: item.success || title,
      why: "Subtask created by the OpenAI agent.",
      notes: item.notes || "",
      recurrence,
      project: projectName,
      status: "open",
      createdAt: new Date().toISOString(),
      updates: []
    });
  }) : [];
  state.tasks = [projectChat, ...subtasks, ...state.tasks];
  state.activeChatId = projectChat.id;
  return projectChat.id;
}

function applyDraftCalendarEventAction(payload) {
  const calendarEvent = {
    id: id(),
    title: payload.title || "Calendar event",
    calendar: normalizeActionOwner(payload.calendar),
    start: payload.start || todayISO() + "T09:00",
    end: payload.end || todayISO() + "T09:30",
    location: payload.location || "",
    notes: payload.notes || "Drafted by the OpenAI agent.",
    status: "draft",
    createdAt: new Date().toISOString()
  };
  state.google.events.unshift(calendarEvent);
  return calendarEvent.id;
}

function applyUpdateCalendarEventAction(payload) {
  const target = state.google.events.find((event) => event.id === payload.eventId)
    || state.google.events.find((event) => payload.title && event.title.toLowerCase() === String(payload.title).toLowerCase());
  if (!target) return applyDraftCalendarEventAction(payload);
  ["title", "start", "end", "location", "notes", "status"].forEach((key) => {
    if (payload[key]) target[key] = payload[key];
  });
  if (payload.calendar) target.calendar = normalizeActionOwner(payload.calendar);
  target.updatedAt = new Date().toISOString();
  return target.id;
}

function buildAgentReply(task, text) {
  const lower = text.toLowerCase();
  const owner = profileName(task.owner);
  const ownerProfile = task.owner === "both" ? null : state.profiles[task.owner];
  const tone = ownerProfile ? ownerProfile.accountabilityTone : "clear and fair";

  const trimmed = lower.trim();

  if (trimmed === "connect your calendars") {
    return "Start in Settings > Google, connect your calendar first, then import Jess' calendar. Once both are imported, I can compare availability and turn events into tasks or projects.";
  }
  if (trimmed === "create your first task or project") {
    return "Tell me the outcome you want, who should own it, and when it matters. If it has multiple steps, I will make it a Project chat; if it is simple, I will make it a task.";
  }
  if (trimmed === "optimize our calendars") {
    const agent = ensureCalendarAgentChat();
    state.activeChatId = agent.id;
    return "I opened the Google Calendar Agent as the shared command center. Once both calendars are connected, I can recommend owners by availability, proximity, and what each person already has on their plate.";
  }
  if (isMealPrepPrompt(lower)) {
    return buildMealPrepReply(task, text);
  }

  if (lower.includes("stuck") || lower.includes("blocked")) {
    task.status = "stuck";
    return `I marked this as stuck. Next move: make the task smaller, name the support needed from ${owner === "Both" ? "each person" : owner}, and agree on a new checkpoint.`;
  }
  if (lower.includes("done") || lower.includes("complete")) {
    task.status = "done";
    return `Logged as done. The useful follow-up is to capture what made this work so future task chats can reuse the pattern.`;
  }
  if (lower.includes("remind") || lower.includes("nudge")) {
    return `Suggested nudge for ${owner}: "${task.success || task.title} is the next action. What is the smallest next action you can complete before ${formatDate(task.due)}?" I would keep the tone ${tone}.`;
  }
  if (lower.includes("calendar") || lower.includes("event") || lower.includes("meeting") || lower.includes("schedule")) {
    if (task.calendarAgent) return createCalendarDraftFromChat(task, text);
    const agent = ensureCalendarAgentChat();
    agent.messages.push({ role: "user", author: state.activeUser, text });
    const reply = createCalendarDraftFromChat(agent, text);
    agent.messages.push({ role: "assistant", text: reply });
    return "I routed this to the shared Google Calendar Agent so calendar work stays in one recurring thread. I also left this note here so the task chat keeps context.";
  }
  if (lower.includes("reminder") || lower.includes("accountability") || lower.includes("overdue") || lower.includes("behind")) {
    runAccountabilityProcess(task);
    return task.accountabilityLog[0]?.draft || "I started the reminder process and logged the outreach draft.";
  }
  if (lower.includes("wedding") || lower.includes("plan")) {
    return `For planning work, I would split this into owner-based chats: budget, venue/date, guest list, vendors, invitations, attire, ceremony timeline, and final-week checklist. Each chat should have one task note and one escalation path.`;
  }
  if (shouldOfferBalancedPath(lower)) {
    return buildBalancedPathReply(task, text);
  }
  return `I am tracking this under ${task.category}. Current owner: ${owner}. Task note: ${task.success || "not set yet"}. Best next step: ask for one concrete action, one deadline, and one support request.`;
}

function shouldOfferBalancedPath(lower) {
  return [
    "disagree",
    "argument",
    "fight",
    "frustrated",
    "upset",
    "unfair",
    "not fair",
    "compromise",
    "both",
    "wife",
    "husband",
    "partner",
  ].some((word) => lower.includes(word));
}

function buildBalancedPathReply(task, text) {
  const profileA = state.profiles.partnerA;
  const profileB = state.profiles.partnerB;
  const nameA = profileName("partnerA");
  const nameB = profileName("partnerB");
  const sharedValues = mergeTop(splitList(profileA.values), splitList(profileB.values), ["calm", "follow-through", "feeling respected"]);
  const repairA = profileA.repairAttempts || "a quick reset and a clear next step";
  const repairB = profileB.repairAttempts || "a quick reset and a clear next step";
  const topic = task.title || "this";

  return `I want to help you two land this in a way that feels good for both of you, not like one person won and the other absorbed the cost.

Here is the lighter path I would try for "${topic}":

1. Name the shared goal first: ${sharedValues.slice(0, 2).join(" and ")}.
2. Make the decision smaller: what needs to be decided today, and what can wait?
3. Protect one need from each side. ${nameA} may need ${profileA.fairness || "visible effort and a clear owner"}. ${nameB} may need ${profileB.fairness || "enough notice and to feel consulted"}.
4. Trade flexibility, not values. Each person gives ground on timing, method, or scope while keeping the real need intact.
5. If the mood gets tight, use the reset that works: for ${nameA}, ${repairA}; for ${nameB}, ${repairB}.

My recommendation: choose the smallest next action that reduces pressure for both of you, then put it back into this chat with an owner and a check-in time.`;
}

function isMealPrepPrompt(lower) {
  return [
    "meal prep",
    "mealprep",
    "costco",
    "grocery",
    "groceries",
    "shopping list",
    "weekly grocery list",
    "broccoli",
    "lettuce",
    "ingredients"
  ].some((word) => lower.includes(word));
}

function buildMealPrepReply(task, text) {
  const project = ensureMealPrepProject();
  const listTask = ensureMealPrepListTask();
  const items = extractGroceryItems(text);
  const recommendation = recommendMealPrepOwner();

  if (items.length) {
    listTask.messages.push({
      role: "assistant",
      text: "Added to the Weekly Meal Prep grocery list: " + items.join(", ") + "."
    });
  }

  const ideas = [
    {
      name: "Chicken quinoa power bowls",
      ingredients: ["rotisserie chicken", "quinoa", "broccoli", "spring mix", "avocado cups", "Greek yogurt"],
      link: "https://www.google.com/search?q=chicken+quinoa+power+bowl+recipe"
    },
    {
      name: "Salmon rice bowls",
      ingredients: ["salmon fillets", "microwave rice", "cucumbers", "lettuce", "edamame", "low-sodium soy sauce"],
      link: "https://www.google.com/search?q=healthy+salmon+rice+bowl+recipe"
    },
    {
      name: "Turkey chili meal prep",
      ingredients: ["ground turkey", "canned beans", "diced tomatoes", "frozen peppers", "onions", "spice blend"],
      link: "https://www.google.com/search?q=healthy+turkey+chili+meal+prep+recipe"
    }
  ];

  const mirrorToProject = task.id !== project.id;
  if (mirrorToProject) {
    project.messages.push({
      role: "user",
      author: state.activeUser,
      text
    });
  }
  state.activeChatId = project.id;

  const itemLine = items.length
    ? "I also added " + items.join(" and ") + " to the weekly grocery list.\n\n"
    : "";
  const reply = itemLine + "Created Project: Weekly Meal Prep\n\n" +
    "Costco shopping list:\n" +
    ideas.map((idea) => "- " + idea.name + ": " + idea.ingredients.join(", ") + "\n  Cook: " + idea.link).join("\n") +
    "\n\nOwner recommendation:\n" +
    "- " + recommendation.ownerName + " should take the first shopping/prep handoff. " + recommendation.reason +
    "\n- Backup: " + recommendation.backupName + ".\n\n" +
    "Next action: approve the three meals, then I will turn the shopping list, prep blocks, and calendar invite into tasks.";
  if (mirrorToProject) project.messages.push({ role: "assistant", text: reply });
  return reply;
}

function ensureMealPrepProject() {
  const projectName = "Weekly Meal Prep";
  let project = state.tasks.find((task) => task.project === projectName && task.chatTitle === projectName);
  if (project) return project;

  project = normalizeTask({
    id: id(),
    title: projectName + ": project plan",
    chatTitle: projectName,
    agentName: "Meal Prep Agent",
    owner: "both",
    due: addDays(todayISO(), 7),
    category: "Home",
    accountabilityPath: "all",
    accountabilityGraceDays: 1,
    success: "Meals are chosen, groceries are bought, prep blocks are scheduled, and the weekly list is current.",
    why: "Weekly meal prep is a recurring household workflow that should become calendar-backed action.",
    project: projectName,
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      { role: "assistant", text: "This is the Weekly Meal Prep Project chat. I will manage meal ideas, grocery lists, owner recommendations, and calendar prep blocks." }
    ]
  });
  state.tasks.unshift(project);
  return project;
}

function ensureMealPrepListTask() {
  const projectName = "Weekly Meal Prep";
  let task = state.tasks.find((item) => item.project === projectName && item.chatTitle === "Costco grocery list");
  if (task) return task;

  task = normalizeTask({
    id: id(),
    title: projectName + ": Costco grocery list",
    chatTitle: "Costco grocery list",
    agentName: "Meal Prep Agent",
    owner: "both",
    due: addDays(todayISO(), 2),
    category: "Home",
    accountabilityPath: "all",
    accountabilityGraceDays: 0,
    success: "The Costco list is complete before the shopping run.",
    why: "The grocery list should stay connected to the meal prep project and the couple calendar.",
    project: projectName,
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      { role: "assistant", text: "I will keep Costco ingredients here and turn approved shopping into calendar-backed actions." }
    ]
  });
  state.tasks.splice(1, 0, task);
  return task;
}

function extractGroceryItems(text) {
  const lower = text.toLowerCase();
  const knownItems = [
    "broccoli",
    "lettuce",
    "chicken",
    "salmon",
    "turkey",
    "quinoa",
    "rice",
    "beans",
    "tomatoes",
    "cucumbers",
    "eggs",
    "yogurt"
  ];
  return knownItems.filter((item) => lower.includes(item));
}

function recommendMealPrepOwner() {
  const today = new Date(todayISO() + "T12:00:00");
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const countEvents = (person) => importedCalendarEventsFor(person).filter((event) => {
    const date = new Date((event.date || todayISO()) + "T12:00:00");
    return date >= today && date <= nextWeek;
  }).length;
  const aCount = countEvents("partnerA");
  const bCount = countEvents("partnerB");

  if (aCount === 0 && bCount === 0) {
    return {
      owner: "both",
      ownerName: "Both of you",
      backupName: "Google Calendar Agent",
      reason: "I do not have imported calendar conflicts yet, so I would keep ownership shared until both calendars are connected."
    };
  }

  const owner = aCount <= bCount ? "partnerA" : "partnerB";
  const backup = owner === "partnerA" ? "partnerB" : "partnerA";
  return {
    owner,
    ownerName: profileName(owner),
    backupName: profileName(backup),
    reason: profileName(owner) + " has fewer imported calendar conflicts over the next 7 days (" + Math.min(aCount, bCount) + " vs " + Math.max(aCount, bCount) + ")."
  };
}
function createCalendarDraftFromChat(task, text) {
  const title = task.title === "New chat" ? "Calendar event" : task.title;
  const calendarEvent = {
    id: id(),
    title,
    calendar: task.owner || "both",
    start: `${todayISO()}T09:00`,
    end: `${todayISO()}T09:30`,
    location: "",
    notes: `Drafted from chat: ${text}`,
    status: "draft",
    createdAt: new Date().toISOString()
  };
  state.google.events.unshift(calendarEvent);
  task.project = task.project || "Google Calendar";
  if (task.calendarAgent) task.agentName = "Google Calendar Agent";
  task.messages.push({
    role: "assistant",
    text: calendarEventSummary(calendarEvent)
  });
  return `I drafted a calendar event from this chat. It is not synced yet, but it is ready in Settings > Google.\n\n${calendarEventSummary(calendarEvent)}`;
}

function bindProfiles() {
  $all(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePerson = button.dataset.person;
      saveState();
      renderProfileForm();
    });
  });

  $("#profileForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const person = state.activePerson;
    state.profiles[person] = {
      name: $("#profileName").value.trim() || profileName(person),
      planningStyle: $("#planningStyle").value,
      accountabilityTone: $("#accountabilityTone").value,
      conflictPattern: $("#conflictPattern").value,
      repairAttempts: $("#repairAttempts").value.trim(),
      values: $("#values").value.trim(),
      fairness: $("#fairness").value.trim(),
      avoid: $("#avoid").value.trim(),
      energy: $("#energy").value,
      notice: $("#notice").value
    };
    addLearning(person, `${profileName(person)} responds best to ${state.profiles[person].accountabilityTone} accountability and ${state.profiles[person].planningStyle}.`, "Onboarding");
    saveState();
    renderAll();
    toast(`${profileName(person)} profile saved.`);
  });
}

function renderProfileForm() {
  const person = state.activePerson;
  const profile = state.profiles[person];
  $all(".segment").forEach((button) => button.classList.toggle("active", button.dataset.person === person));
  $("#profileName").value = profile.name || "";
  $("#planningStyle").value = profile.planningStyle;
  $("#accountabilityTone").value = profile.accountabilityTone;
  $("#conflictPattern").value = profile.conflictPattern;
  $("#repairAttempts").value = profile.repairAttempts;
  $("#values").value = profile.values;
  $("#fairness").value = profile.fairness;
  $("#avoid").value = profile.avoid;
  $("#energy").value = profile.energy;
  $("#notice").value = profile.notice;
}

function bindTasks() {
  $("#taskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#taskTitle").value.trim();
    const category = $("#taskCategory").value;
    const task = normalizeTask({
      id: id(),
      title,
      chatTitle: $("#taskChatName").value.trim() || title,
      agentName: defaultAgentName(category),
      notes: $("#taskNotes").value.trim(),
      owner: $("#taskOwner").value,
      due: $("#taskDue").value,
      category,
      accountabilityPath: $("#taskAccountabilityPath").value,
      accountabilityGraceDays: Number($("#taskGrace").value),
      success: title,
      why: "",
      status: "open",
      createdAt: new Date().toISOString(),
      updates: []
    });
    state.tasks.unshift(task);
    state.activeChatId = task.id;
    addLearning(task.owner, `${profileName(task.owner)} is connected to a ${task.category.toLowerCase()} commitment: ${task.title}.`, "Task follow-up");
    event.target.reset();
    setDefaultDates();
    saveState();
    renderAll();
    showView("chat");
    toast("Task chat created.");
  });

  $all("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTaskFilter = button.dataset.filter;
      saveState();
      renderTasks();
    });
  });

  $("#taskList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-task-action]");
    if (!button) return;
    const task = state.tasks.find((item) => item.id === button.dataset.taskId);
    if (!task) return;
    if (button.dataset.taskAction === "select") {
      state.activeChatId = task.id;
      showView("chat");
    } else {
      handleTaskAction(task, button.dataset.taskAction);
    }
    saveState();
    renderAll();
  });

  $("#inspectorBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-task-action]");
    if (!button) return;
    const task = activeTask();
    if (!task) return;
    if (button.dataset.taskAction === "accountability") {
      runAccountabilityProcess(task);
    } else if (button.dataset.taskAction === "needs-help") {
      recordAccountabilityResponse(task, "needs help");
    } else if (button.dataset.taskAction === "just-behind") {
      recordAccountabilityResponse(task, "just behind");
    } else {
      handleTaskAction(task, button.dataset.taskAction);
    }
    saveState();
    renderAll();
  });
}

function handleTaskAction(task, action) {
  if (action === "done") {
    task.status = "done";
    task.updates.push({ at: new Date().toISOString(), note: "Marked complete." });
    task.messages.push({ role: "assistant", text: "Marked complete. I will keep this chat as the record of what worked." });
  }
  if (action === "stuck") {
    task.status = "stuck";
    task.updates.push({ at: new Date().toISOString(), note: "Needs help, renegotiation, or a smaller next step." });
    task.messages.push({ role: "assistant", text: "Marked stuck. I recommend shrinking the next action and naming the exact support request." });
  }
  if (action === "open") {
    task.status = "open";
    task.updates.push({ at: new Date().toISOString(), note: "Reopened with a clearer next step." });
    task.messages.push({ role: "assistant", text: "Reopened. Let's name the next action and who owns it." });
  }
  if (action === "delete") {
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    state.activeChatId = state.tasks[0]?.id || null;
  }
}

function isTaskPastDue(task) {
  if (!task.due || task.status === "done") return false;
  const due = new Date(`${task.due}T12:00:00`);
  due.setDate(due.getDate() + Number(task.accountabilityGraceDays || 0));
  const today = new Date(`${todayISO()}T12:00:00`);
  return due < today;
}

function nextAccountabilityChannel(task) {
  const path = task.accountabilityPath || "email";
  const sentCount = task.accountabilityLog.filter((item) => item.kind === "outreach").length;
  if (path === "all") return ["email", "text", "call"][Math.min(sentCount, 2)];
  return path;
}

function runAccountabilityProcess(task) {
  const channel = nextAccountabilityChannel(task);
  const owner = profileName(task.owner);
  const draft = accountabilityDraft(task, channel);
  task.accountabilityState = "waiting-for-response";
  task.accountabilityLog.unshift({
    id: id(),
    kind: "outreach",
    channel,
    at: new Date().toISOString(),
    draft
  });
  task.messages.push({
    role: "assistant",
    text: `${channelLabel(channel)} reminder drafted for ${owner}.\n\n${draft}`
  });
  toast(`${channelLabel(channel)} reminder drafted.`);
}

function recordAccountabilityResponse(task, response) {
  task.accountabilityState = response;
  task.status = response === "needs help" ? "stuck" : "open";
  const note = response === "needs help"
    ? "Owner says they are behind because they need help. Convert the task into a smaller next step and name the support request."
    : "Owner says they are just behind. Keep ownership intact and ask for a new realistic checkpoint.";
  task.accountabilityLog.unshift({
    id: id(),
    kind: "response",
    response,
    at: new Date().toISOString(),
    draft: note
  });
  task.messages.push({ role: "assistant", text: note });
  toast(`Reminder response logged: ${response}.`);
}

function channelLabel(channel) {
  if (channel === "email") return "Email";
  if (channel === "text") return "Text";
  return "AI phone call";
}

function accountabilityDraft(task, channel) {
  const owner = profileName(task.owner);
  const finish = task.success || task.title;
  const ask = `Are you behind because you need help, or are you just behind and need a new checkpoint?`;
  if (channel === "text") {
    return `Text to ${owner}: Quick reminder on "${task.title}". Finish line: ${finish}. ${ask}`;
  }
  if (channel === "call") {
    return `AI call script for ${owner}: "I am calling about ${task.title}. It was due ${formatDate(task.due)}. I am not here to shame you. I need to know whether you are behind because you need help, or just behind. If you need help, what support would unblock this? If you are just behind, what new checkpoint can you commit to?"`;
  }
  return `Email to ${owner}\nSubject: Reminder: ${task.title}\n\nThis task is past due: ${task.title}.\n\nTask note: ${finish}\n\n${ask}\n\nIf you need help, reply with the blocker and the support request. If you are just behind, reply with the new checkpoint you can honor.`;
}

function setDefaultDates() {
  const due = $("#taskDue");
  if (due && !due.value) due.value = todayISO();
  const calendarDate = $("#calendarDate");
  if (calendarDate && !calendarDate.value) calendarDate.value = todayISO();
  const eventStart = $("#eventStart");
  const eventEnd = $("#eventEnd");
  if (eventStart && !eventStart.value) eventStart.value = `${todayISO()}T09:00`;
  if (eventEnd && !eventEnd.value) eventEnd.value = `${todayISO()}T09:30`;
}

function bindIntegrations() {
  $("#toggleGoogleConnection").addEventListener("click", () => {
    state.google.connected = !state.google.connected;
    saveState();
    renderIntegrations();
    toast(state.google.connected ? "Google Calendar marked connected." : "Google Calendar marked disconnected.");
  });

  $("#calendarReviewForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const recommendation = buildCalendarRecommendation();
    state.google.recommendations.unshift(recommendation);
    addLearning(recommendation.owner, `${recommendation.ownerName} is the recommended owner for ${recommendation.needLabel} at ${recommendation.destination} because ${recommendation.reason}.`, "Calendar review");
    saveState();
    renderIntegrations();
    toast("Calendar recommendation created.");
  });

  $("#calendarEventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const calendarEvent = {
      id: id(),
      title: $("#eventTitle").value.trim(),
      calendar: $("#eventCalendar").value,
      start: $("#eventStart").value,
      end: $("#eventEnd").value,
      location: $("#eventLocation").value.trim(),
      notes: $("#eventNotes").value.trim(),
      status: "draft",
      createdAt: new Date().toISOString()
    };
    state.google.events.unshift(calendarEvent);
    const task = normalizeTask({
      id: id(),
      title: `Calendar: ${calendarEvent.title}`,
      chatTitle: calendarEvent.title,
      agentName: "Calendar Task Agent",
      owner: calendarEvent.calendar,
      due: calendarEvent.start ? calendarEvent.start.slice(0, 10) : todayISO(),
      category: "Admin",
      accountabilityPath: "all",
      accountabilityGraceDays: 0,
      success: `Event is synced to ${calendarLabel(calendarEvent.calendar)} with location and notes confirmed.`,
      why: calendarEvent.notes || "Calendar coordination prevents missed handoffs.",
      project: "Google Calendar",
      status: "open",
      createdAt: new Date().toISOString(),
      updates: [],
      messages: [
        { role: "assistant", text: `I drafted a Google Calendar event for "${calendarEvent.title}". Production mode would create this through the Google Calendar API after approval.` },
        { role: "assistant", text: calendarEventSummary(calendarEvent) }
      ]
    });
    state.tasks.unshift(task);
    state.activeChatId = task.id;
    event.target.reset();
    setDefaultDates();
    saveState();
    renderAll();
    showView("chat");
    toast("Calendar event drafted and task chat created.");
  });

  $("#calendarEventList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-action]");
    if (!button) return;
    const calendarEvent = state.google.events.find((item) => item.id === button.dataset.eventId);
    if (!calendarEvent) return;
    if (button.dataset.eventAction === "mark-synced") calendarEvent.status = "ready-to-sync";
    saveState();
    renderIntegrations();
  });
}

function registerMobileRuntime() {
  const canUseServiceWorker = "serviceWorker" in navigator
    && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1");

  if (canUseServiceWorker) {
    navigator.serviceWorker.register("./sw.js").then(() => {
      document.documentElement.dataset.sw = "ready";
      renderMobileStatus();
    }).catch(() => {
      document.documentElement.dataset.sw = "blocked";
      renderMobileStatus();
    });
  } else {
    document.documentElement.dataset.sw = "unavailable";
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    window.deferredInstallPrompt = event;
    renderMobileStatus();
  });

  window.addEventListener("appinstalled", () => {
    document.documentElement.dataset.installed = "true";
    window.deferredInstallPrompt = null;
    renderMobileStatus();
  });
}

function buildCalendarRecommendation() {
  const need = $("#calendarNeed").value;
  const destination = $("#calendarDestination").value.trim();
  const date = $("#calendarDate").value;
  const time = $("#calendarTime").value;
  const context = $("#calendarContext").value.trim();
  const a = scoreCalendarPerson("partnerA", $("#calendarAStatus").value, Number($("#calendarAMinutes").value || 0));
  const b = scoreCalendarPerson("partnerB", $("#calendarBStatus").value, Number($("#calendarBMinutes").value || 0));
  const winner = a.score <= b.score ? a : b;
  const backup = winner.person === "partnerA" ? b : a;
  const recommendation = {
    id: id(),
    need,
    needLabel: needLabel(need),
    destination,
    date,
    time,
    context,
    owner: winner.person,
    ownerName: profileName(winner.person),
    backupName: profileName(backup.person),
    reason: `${winner.statusLabel.toLowerCase()} and ${winner.minutes} minutes away versus ${backup.statusLabel.toLowerCase()} and ${backup.minutes} minutes away`,
    createdAt: new Date().toISOString()
  };
  $("#eventTitle").value = `${recommendation.needLabel}: ${destination}`;
  $("#eventCalendar").value = recommendation.owner;
  $("#eventLocation").value = destination;
  $("#eventNotes").value = `${recommendation.ownerName} recommended. Reason: ${recommendation.reason}.${context ? ` Context: ${context}` : ""}`;
  if (date && time) {
    $("#eventStart").value = `${date}T${time}`;
    $("#eventEnd").value = addMinutes(`${date}T${time}`, 30);
  }
  return recommendation;
}

function scoreCalendarPerson(person, status, minutes) {
  const statusPenalty = status === "busy" ? 100 : status === "soft" ? 35 : 0;
  return {
    person,
    status,
    statusLabel: status === "busy" ? "Busy" : status === "soft" ? "Soft conflict" : "Free",
    minutes,
    score: statusPenalty + minutes
  };
}

function needLabel(need) {
  if (need === "kids") return "Pick up kids";
  if (need === "groceries") return "Pick up groceries";
  if (need === "meeting") return "Meeting";
  return "Errand";
}

function addMinutes(value, minutes) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + Number(minutes));
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function calendarLabel(calendar) {
  if (calendar === "partnerA") return `${profileName("partnerA")}'s calendar`;
  if (calendar === "partnerB") return `${profileName("partnerB")}'s calendar`;
  return "the shared family calendar";
}

function calendarEventSummary(calendarEvent) {
  return `Calendar: ${calendarLabel(calendarEvent.calendar)}\nStart: ${calendarEvent.start || "Not set"}\nEnd: ${calendarEvent.end || "Not set"}\nLocation: ${calendarEvent.location || "Not set"}\nNotes: ${calendarEvent.notes || "None"}`;
}

function bindPlanning() {
  const projectList = $("#projectList");
  if (projectList) {
    projectList.addEventListener("click", (event) => {
      const projectButton = event.target.closest("[data-project-name]");
      if (projectButton) {
        state.activeProjectName = projectButton.dataset.projectName;
        saveState();
        renderProjects();
        return;
      }
      const chatButton = event.target.closest("[data-search-chat]");
      if (!chatButton) return;
      state.activeChatId = chatButton.dataset.searchChat;
      saveState();
      renderAll();
      showView("chat");
    });
  }

  const projectDetail = $("#projectDetail");
  if (projectDetail) {
    projectDetail.addEventListener("click", (event) => {
      const chatButton = event.target.closest("[data-search-chat]");
      if (!chatButton) return;
      state.activeChatId = chatButton.dataset.searchChat;
      saveState();
      renderAll();
      showView("chat");
    });
  }

  $("#planForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const planName = $("#planName").value.trim();
    const targetDate = $("#planDate").value;
    const owner = $("#planOwner").value;
    const recurrence = $("#planRecurrence").value;
    const notes = $("#planPriorities").value.trim();
    const tasks = createRecommendedProject(planName, targetDate, owner, notes, recurrence);
    state.tasks = [...tasks, ...state.tasks];
    state.activeProjectName = planName;
    state.activeChatId = tasks[0]?.id || state.activeChatId;
    addLearning(owner, planName + " is an active project. Repeats: " + recurrenceLabel(recurrence) + ". Notes: " + (notes || "not yet specified") + ".", "Project setup");
    event.target.reset();
    saveState();
    renderAll();
    showView("projects");
    toast("Project created.");
  });
}
function createRecommendedProject(projectName, targetDate, owner, notes, recurrence = "none") {
  const category = inferProjectCategory(projectName + " " + notes);
  const due = targetDate || addDays(todayISO(), 14);
  const projectChat = normalizeTask({
    id: id(),
    title: projectName + ": project plan",
    chatTitle: projectName,
    agentName: "Project Planning Agent",
    owner,
    due,
    category,
    accountabilityPath: "all",
    accountabilityGraceDays: 1,
    success: notes || projectName,
    why: "Project created from the Projects section.",
    notes,
    recurrence,
    project: projectName,
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      { role: "assistant", text: "I created this project chat. I will keep recommendations here and turn approved ideas into subtasks." },
      { role: "assistant", text: projectRecommendationText(projectName, notes, recurrence) }
    ]
  });
  const subtasks = recommendedProjectSubtasks(projectName, due, owner, category, notes, recurrence);
  return [projectChat, ...subtasks];
}

function inferProjectCategory(text) {
  const lower = text.toLowerCase();
  if (lower.includes("meal") || lower.includes("grocery") || lower.includes("costco") || lower.includes("home")) return "Home";
  if (lower.includes("wedding")) return "Wedding";
  if (lower.includes("business") || lower.includes("launch") || lower.includes("client")) return "Business";
  if (lower.includes("kid") || lower.includes("family")) return "Family";
  if (lower.includes("doctor") || lower.includes("health")) return "Health";
  if (lower.includes("money") || lower.includes("budget")) return "Money";
  return "Admin";
}

function normalizeRecurrence(value) {
  const allowed = ["none", "daily", "weekly", "biweekly", "monthly", "quarterly"];
  return allowed.includes(value) ? value : "none";
}

function recurrenceLabel(value) {
  const labels = {
    none: "One-time",
    daily: "Daily",
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    monthly: "Monthly",
    quarterly: "Quarterly"
  };
  return labels[value] || labels.none;
}

function projectRecommendationText(projectName, notes, recurrence = "none") {
  const context = notes ? " Based on your notes: " + notes + "." : "";
  const rhythm = recurrence !== "none" ? " This is a " + recurrenceLabel(recurrence).toLowerCase() + " project, so I will expect this chat to stay useful on that rhythm." : " This looks like a one-time project.";
  return "AI recommendations for " + projectName + ": start with the smallest useful outcome, assign one owner per subtask, add calendar time only where it prevents a miss, and keep decisions in this project chat." + rhythm + context;
}

function recommendedProjectSubtasks(projectName, due, owner, category, notes, recurrence = "none") {
  const lower = (projectName + " " + notes).toLowerCase();
  let titles = ["Decide the next outcome", "List the first actions", "Schedule the work block"];
  if (lower.includes("meal") || lower.includes("costco") || lower.includes("grocery")) {
    titles = ["Pick meals", "Build the shopping list", "Schedule prep time"];
  } else if (lower.includes("wedding")) {
    titles = ["Name the next decision", "Assign vendor or family follow-up", "Schedule planning time"];
  } else if (lower.includes("business") || lower.includes("launch")) {
    titles = ["Define launch outcome", "List blockers", "Assign first follow-up"];
  }
  return titles.map((title, index) => normalizeTask({
    id: id(),
    title: projectName + ": " + title,
    chatTitle: title,
    agentName: defaultAgentName(category),
    owner: index === 0 ? owner : "both",
    due: addDays(due || todayISO(), index),
    category,
    accountabilityPath: "all",
    accountabilityGraceDays: 0,
    success: title,
    why: "AI-recommended subtask for " + projectName + ".",
    notes: notes || "",
    recurrence,
    project: projectName,
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      { role: "assistant", text: "Recommended by the Project Planning Agent. Adjust owner or timing as needed." }
    ]
  }));
}
function createPlanTask(config, success) {
  const due = config.targetDate ? addDays(config.targetDate, config.offset) : todayISO();
  return normalizeTask({
    id: id(),
    title: `${config.planName}: ${config.title}`,
    chatTitle: config.title,
    agentName: config.agentName,
    owner: config.owner,
    due,
    category: config.category,
    accountabilityPath: "all",
    accountabilityGraceDays: 1,
    success,
    why: config.priorities
      ? `Part of ${config.planName}. Priorities: ${config.priorities}.`
      : `Part of ${config.planName}.`,
    project: config.planName,
    status: "open",
    createdAt: new Date().toISOString(),
    updates: [],
    messages: [
      {
        role: "assistant",
        text: `I am the ${config.agentName} for "${config.title}" inside ${config.planName}. I will keep decisions, owners, and overdue reminders attached to this workstream.`
      },
      {
        role: "assistant",
        text: `Task note: ${success}`
      }
    ]
  });
}

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function mergeTop(listA, listB, fallback) {
  const seen = new Set();
  return [...listA, ...listB, ...fallback]
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function bindLearning() {
  $("#learningForm").addEventListener("submit", (event) => {
    event.preventDefault();
    addLearning($("#learningPerson").value, $("#learningSignal").value.trim(), $("#learningSource").value);
    event.target.reset();
    saveState();
    renderAll();
    toast("Preference saved.");
  });
}

function addLearning(person, signal, source) {
  if (!signal) return;
  const exists = state.learnings.some((item) => item.person === person && item.signal.toLowerCase() === signal.toLowerCase());
  if (exists) return;
  state.learnings.unshift({
    id: id(),
    person,
    signal,
    source,
    createdAt: new Date().toISOString()
  });
}

function bindDemo() {
  $("#seedDemo").addEventListener("click", () => {
    const firstTask = normalizeTask({
      id: id(),
      title: "Choose a weekly planning time",
      chatTitle: "Weekly planning",
      agentName: "Household Chief of Staff Agent",
      owner: "both",
      due: todayISO(),
      category: "Relationship",
      success: "A recurring 20 minute slot is agreed on.",
      why: "Reduces last-minute planning pressure.",
      status: "open",
      createdAt: new Date().toISOString(),
      updates: []
    });
    const secondTask = normalizeTask({
      id: id(),
      title: "Draft the household task list",
      chatTitle: "Invisible work audit",
      agentName: "Home Operations Agent",
      owner: "partnerA",
      due: todayISO(),
      category: "Home",
      success: "Top 10 recurring tasks are listed with current owner.",
      why: "Makes invisible work visible.",
      status: "open",
      createdAt: new Date().toISOString(),
      updates: []
    });

    state.profiles.partnerA = {
      ...state.profiles.partnerA,
      name: "Rich",
      planningStyle: "clear steps",
      accountabilityTone: "brief and practical",
      conflictPattern: "solve quickly",
      values: "reliability, calm routines, initiative",
      fairness: "a clear owner and visible progress",
      avoid: "vague asks and repeated reminders",
      repairAttempts: "summarize my point, then ask for the next step",
      energy: "3",
      notice: "4"
    };
    state.profiles.partnerB = {
      ...state.profiles.partnerB,
      name: "Jess",
      planningStyle: "a shared plan",
      accountabilityTone: "gentle and curious",
      conflictPattern: "need time",
      values: "connection, thoughtfulness, follow-through",
      fairness: "being consulted before plans change",
      avoid: "pressure when emotions are high",
      repairAttempts: "a pause, reassurance, and a concrete plan",
      energy: "3",
      notice: "5"
    };
    state.auth = {
      partnerA: { signedIn: true, signedInAt: new Date().toISOString() },
      partnerB: { signedIn: true, signedInAt: new Date().toISOString() }
    };
    state.activeUser = "partnerA";
    state.tasks = [firstTask, secondTask];
    state.activeChatId = firstTask.id;
    addLearning("both", "Weekly planning should happen before the weekend starts.", "Manual note");
    saveState();
    renderAll();
    toast("Example chats loaded.");
  });
}

function renderAll() {
  renderAuthGate();
  renderPersonLabels();
  renderProfileForm();
  renderDashboardCalendar();
  renderChatList();
  renderChat();
  renderTasks();
  renderProjects();
  renderIntegrations();
  renderMobileStatus();
  renderSearch();
  renderLearning();
}

function renderSearch() {
  const input = $("#globalSearchInput");
  const target = $("#searchResults");
  if (!input || !target) return;
  const query = input.value.trim().toLowerCase();
  if (!query) {
    target.innerHTML = `<div class="empty-state"><strong>Search everything.</strong><p>Try a chat name, agent, owner, task, calendar event, or note.</p></div>`;
    return;
  }

  const taskResults = state.tasks.filter((task) => {
    const haystack = [
      task.title,
      task.chatTitle,
      task.agentName,
      task.category,
      task.project,
      task.success,
      task.why,
      profileName(task.owner),
      ...task.messages.map((message) => message.text)
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  const eventResults = state.google.events.filter((event) => {
    const haystack = [event.title, event.location, event.notes, calendarLabel(event.calendar), event.status].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  const renderedTasks = taskResults.map((task) => `
    <article class="task-card">
      <div class="task-top">
        <div>
          <h3 class="task-title">${escapeHtml(task.chatTitle)}</h3>
          <div class="meta">${escapeHtml(task.agentName)} - ${escapeHtml(profileName(task.owner))}</div>
        </div>
        <span class="badge">${escapeHtml(task.category)}</span>
      </div>
      <p>${escapeHtml(task.success || task.why || task.title)}</p>
      <div class="card-actions">
        <button class="card-action" data-search-chat="${escapeHtml(task.id)}" type="button">Open chat</button>
      </div>
    </article>
  `).join("");

  const renderedEvents = eventResults.map((event) => `
    <article class="event-card">
      <div>
        <h4>${escapeHtml(event.title)}</h4>
        <p>${escapeHtml(calendarEventSummary(event))}</p>
      </div>
      <span class="badge blue">Calendar draft</span>
    </article>
  `).join("");

  target.innerHTML = renderedTasks || renderedEvents
    ? `${renderedTasks}${renderedEvents}`
    : `<div class="empty-state"><strong>No matches.</strong><p>Try a broader word or create a new chat.</p></div>`;
}

function calendarViewLabel(view) {
  if (view === "mine") return "My Calendar";
  if (view === "jess") return possessiveName(profileName("partnerB")) + " Calendar";
  return "Shared Calendar";
}

function calendarViewPerson(view) {
  if (view === "mine") return "partnerA";
  if (view === "jess") return "partnerB";
  return "both";
}

function importedCalendarEventsFor(person) {
  return state.google.events
    .filter((event) => event.source === "google-import" && event.importedFor === person)
    .sort((a, b) => String(a.start || a.date).localeCompare(String(b.start || b.date)));
}

function renderPersonalCalendarEvent(calendarEvent) {
  return `
    <article class="shared-event-card personal-calendar-card">
      <div class="shared-event-top">
        <div>
          <h4>${escapeHtml(calendarEvent.title)}</h4>
          <p>${escapeHtml(formatDate(calendarEvent.date))} at ${escapeHtml(calendarEvent.time || "All day")} - ${escapeHtml(calendarEvent.location || "Location needed")}</p>
        </div>
        <span class="badge blue">${escapeHtml(calendarLabel(calendarEvent.importedFor || calendarEvent.calendar))}</span>
      </div>
      <div class="badge-row">
        <span class="badge">Imported</span>
        ${calendarEvent.attendees?.length ? `<span class="badge">${escapeHtml(calendarEvent.attendees.length)} attendees</span>` : ""}
      </div>
      <p>${escapeHtml(calendarEvent.notes ? calendarEvent.notes.replace(/<[^>]*>/g, "").slice(0, 180) : "No notes on this calendar event.")}</p>
      <div class="card-actions">
        <button class="card-action" data-calendar-action="open-agent" data-event-id="${escapeHtml(calendarEvent.id)}" type="button">Open agent chat</button>
      </div>
    </article>
  `;
}
function renderDashboardCalendar() {
  const list = $("#sharedEventList");
  if (!list) return;
  const agent = ensureCalendarAgentChat();
  const imported = Boolean(state.sharedCalendar.imported);
  const view = state.sharedCalendar.activeView || "shared";
  const person = calendarViewPerson(view);
  const isShared = view === "shared";


  const select = $("#calendarViewSelect");
  if (select) select.value = view;
  const listEyebrow = $("#calendarListEyebrow");
  if (listEyebrow) listEyebrow.textContent = calendarViewLabel(view);

  if (isShared) {
    list.innerHTML = state.sharedCalendar.events.length
      ? state.sharedCalendar.events.map(renderSharedCalendarEvent).join("")
      : `<div class="empty-state"><strong>No shared events yet.</strong><p>Import both calendars to find events that involve both of you.</p></div>`;
    return;
  }

  const personalEvents = importedCalendarEventsFor(person);
  list.innerHTML = personalEvents.length
    ? personalEvents.map(renderPersonalCalendarEvent).join("")
    : `<div class="empty-state"><strong>No ${escapeHtml(calendarViewLabel(view).toLowerCase())} events yet.</strong><p>Connect and import this Google Calendar in Settings > Google.</p></div>`;
}

function renderSharedCalendarEvent(calendarEvent) {
  const recommendation = recommendSharedEventOwner(calendarEvent);
  const suggestions = calendarEvent.suggestedTasks.map((suggestion, index) => `
    <div class="suggested-task-row">
      <div>
        <strong>${escapeHtml(suggestion.title)}</strong>
        <p>${escapeHtml(suggestion.success || "Ready before the event.")}</p>
      </div>
      <button class="card-action" data-calendar-action="task" data-event-id="${escapeHtml(calendarEvent.id)}" data-suggestion-index="${index}" type="button">Start task</button>
    </div>
  `).join("");

  return `
    <article class="shared-event-card">
      <div class="shared-event-top">
        <div>
          <h4>${escapeHtml(calendarEvent.title)}</h4>
          <p>${escapeHtml(formatDate(calendarEvent.date))} at ${escapeHtml(calendarEvent.time)} - ${escapeHtml(calendarEvent.location)}</p>
        </div>
        <span class="badge blue">Both calendars</span>
      </div>
      <div class="badge-row">
        <span class="badge">${escapeHtml(calendarEvent.category)}</span>
        <span class="badge">${escapeHtml(profileName("partnerA"))}: ${escapeHtml(calendarEvent.availability.partnerA)}, ${escapeHtml(calendarEvent.proximity.partnerA)} min</span>
        <span class="badge">${escapeHtml(profileName("partnerB"))}: ${escapeHtml(calendarEvent.availability.partnerB)}, ${escapeHtml(calendarEvent.proximity.partnerB)} min</span>
      </div>
      <div class="recommendation-result compact">
        <strong>${escapeHtml(recommendation.ownerName)}</strong>
        <p>${escapeHtml(recommendation.reason)}</p>
      </div>
      <div class="suggested-task-list">${suggestions}</div>
      <div class="card-actions">
        <button class="card-action" data-calendar-action="recommend" data-event-id="${escapeHtml(calendarEvent.id)}" type="button">Ask agent</button>
        <button class="card-action" data-calendar-action="project" data-event-id="${escapeHtml(calendarEvent.id)}" type="button">Make project</button>
        <button class="card-action" data-calendar-action="open-agent" data-event-id="${escapeHtml(calendarEvent.id)}" type="button">Open agent chat</button>
      </div>
    </article>
  `;
}

function projectGroups() {
  const groups = new Map();
  state.tasks.filter((task) => task.project && task.project !== "Google Calendar").forEach((task) => {
    if (!groups.has(task.project)) groups.set(task.project, []);
    groups.get(task.project).push(task);
  });
  return Array.from(groups.entries())
    .map(([name, tasks]) => ({ name, tasks }))
    .filter((group) => group.tasks.some((task) => task.status !== "done"));
}

function renderProjects() {
  const target = $("#projectList");
  const detail = $("#projectDetail");
  if (!target || !detail) return;
  const groups = projectGroups();
  if (!groups.length) {
    target.innerHTML = `<div class="empty-state"><strong>No projects yet.</strong><p>Create a project above or promote work from a calendar event.</p></div>`;
    detail.innerHTML = `<div class="empty-state"><strong>Select a project.</strong><p>Subtasks will show here.</p></div>`;
    $("#projectDetailTitle").textContent = "Select a project";
    return;
  }

  if (!state.activeProjectName || !groups.some((group) => group.name === state.activeProjectName)) {
    state.activeProjectName = groups[0].name;
  }

  target.innerHTML = groups.map((group) => {
    const openCount = group.tasks.filter((task) => task.status !== "done").length;
    const projectLead = group.tasks.find((task) => task.chatTitle === group.name) || group.tasks[0];
    const activeClass = group.name === state.activeProjectName ? "active" : "";
    return [
      `<button class="project-card project-select-card ${activeClass}" data-project-name="${escapeHtml(group.name)}" type="button">`,
      `<span><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.tasks.length)} chats - ${escapeHtml(openCount)} open${projectLead.recurrence && projectLead.recurrence !== "none" ? " - " + escapeHtml(recurrenceLabel(projectLead.recurrence)) : ""}</small></span>`,
      `<span class="badge blue">${escapeHtml(profileName(projectLead.owner))}</span>`,
      `</button>`
    ].join("");
  }).join("");

  const active = groups.find((group) => group.name === state.activeProjectName);
  $("#projectDetailTitle").textContent = active ? active.name : "Select a project";
  detail.innerHTML = active
    ? renderProjectDetail(active)
    : `<div class="empty-state"><strong>Select a project.</strong><p>Subtasks will show here.</p></div>`;
}

function renderProjectDetail(group) {
  const projectChat = group.tasks.find((task) => task.chatTitle === group.name) || group.tasks[0];
  const subtasks = group.tasks.filter((task) => task.id !== projectChat.id);
  const firstAssistant = projectChat.messages.find((message) => message.text && message.text.startsWith("AI recommendations")) || projectChat.messages.find((message) => message.role === "assistant");
  return `
    <div class="project-detail-summary">
      <div>
        <p class="eyebrow">Project chat</p>
        <h4>${escapeHtml(projectChat.chatTitle)}</h4>
        <p>${escapeHtml(firstAssistant?.text || "Use the project chat for AI recommendations and decisions.")}</p>
      </div>
      <button class="card-action" data-search-chat="${escapeHtml(projectChat.id)}" type="button">Open project chat</button>
    </div>
    <div class="project-task-list">
      ${subtasks.length ? subtasks.map((task) => `
        <button class="project-task-link" data-search-chat="${escapeHtml(task.id)}" type="button">
          <span>${escapeHtml(task.chatTitle)}</span>
          <small>${escapeHtml(profileName(task.owner))} - ${escapeHtml(task.status)}</small>
        </button>
      `).join("") : `<div class="empty-state"><strong>No subtasks yet.</strong><p>Ask the project chat for recommendations.</p></div>`}
    </div>
  `;
}
function renderMobileStatus() {
  const target = $("#mobileStatus");
  if (!target) return;
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true || document.documentElement.dataset.installed === "true";
  const swState = document.documentElement.dataset.sw || "checking";
  const installAvailable = Boolean(window.deferredInstallPrompt);
  const platform = isIOS ? "iOS" : isAndroid ? "Android" : "Desktop browser";
  const installText = isStandalone
    ? "Installed app mode"
    : installAvailable
      ? "Install prompt available"
      : isIOS
        ? "Use Safari Share, then Add to Home Screen"
        : "Use browser menu, then Install app";
  const swText = swState === "ready"
    ? "Offline shell ready"
    : swState === "unavailable"
      ? "Offline shell needs https or localhost"
      : swState === "blocked"
        ? "Offline shell blocked"
        : "Offline shell checking";

  target.innerHTML = `
    <div class="context-row"><span>Platform</span><strong>${escapeHtml(platform)}</strong></div>
    <div class="context-row"><span>Install</span><strong>${escapeHtml(installText)}</strong></div>
    <div class="context-row"><span>Offline</span><strong>${escapeHtml(swText)}</strong></div>
    <div class="context-row"><span>Storage</span><strong>Local device</strong></div>
    ${installAvailable ? `<button class="primary-button" data-mobile-action="install" type="button">Install CoupleOS</button>` : ""}
  `;
}

function hasGoogleSetup() {
  return Boolean(state.google.oauth.clientId && state.google.oauth.apiKey);
}

function renderGoogleAccounts() {
  const clientInput = $("#googleClientId");
  const keyInput = $("#googleApiKey");
  if (clientInput) clientInput.value = state.google.oauth.clientId || "";
  if (keyInput) keyInput.value = state.google.oauth.apiKey || "";
  const target = $("#googleAccountList");
  if (!target) return;
  target.innerHTML = ["partnerA", "partnerB"].map((person) => {
    const account = state.google.oauth.accounts[person];
    const connected = Boolean(account?.importedAt);
    return `
      <article class="google-account-card">
        <div>
          <h4>${escapeHtml(profileName(person))}</h4>
          <p>${connected ? escapeHtml(account.email) : "Not connected yet"}</p>
          <p class="small-note">${connected ? `${escapeHtml(account.count || 0)} events imported on ${escapeHtml(formatDate(account.importedAt.slice(0, 10)))}` : "Authorize this person's Google account to import their primary calendar."}</p>
        </div>
        <button class="card-action" data-google-person="${escapeHtml(person)}" type="button">${connected ? "Reimport" : "Connect"}</button>
      </article>
    `;
  }).join("");
}
function renderIntegrations() {
  $("#googleStatusTitle").textContent = state.google.connected
    ? "Google Calendar connected"
    : "Google Calendar not connected";
  $("#toggleGoogleConnection").textContent = state.google.connected ? "Disconnect" : "Mark connected";
  const latest = state.google.recommendations[0];
  $("#calendarRecommendation").innerHTML = latest
    ? `
      <div class="recommendation-result">
        <strong>${escapeHtml(latest.ownerName)}</strong>
        <p>${escapeHtml(latest.needLabel)} at ${escapeHtml(latest.destination)} should go to ${escapeHtml(latest.ownerName)}. ${escapeHtml(latest.reason)}.</p>
        <p class="small-note">Backup: ${escapeHtml(latest.backupName)}${latest.context ? ` - ${escapeHtml(latest.context)}` : ""}</p>
      </div>
    `
    : `<div class="empty-state"><strong>No recommendation yet.</strong><p>Review availability and proximity to decide who should own the handoff.</p></div>`;

  $("#calendarEventList").innerHTML = state.google.events.length
    ? state.google.events.map((calendarEvent) => `
      <article class="event-card">
        <div>
          <h4>${escapeHtml(calendarEvent.title)}</h4>
          <p>${escapeHtml(calendarEventSummary(calendarEvent))}</p>
        </div>
        <div class="badge-row">
          <span class="badge">${escapeHtml(calendarEvent.status)}</span>
          <span class="badge blue">${escapeHtml(calendarLabel(calendarEvent.calendar))}</span>
        </div>
        <div class="card-actions">
          <button class="card-action" data-event-action="mark-synced" data-event-id="${escapeHtml(calendarEvent.id)}" type="button">Ready to sync</button>
        </div>
      </article>
    `).join("")
    : emptyState();
}

function renderChatList() {
  $("#chatCount").textContent = state.tasks.length;
  $("#chatList").innerHTML = state.tasks.length
    ? state.tasks.map((task) => `
      <button class="chat-list-item ${task.id === state.activeChatId ? "active" : ""}" data-chat-id="${escapeHtml(task.id)}" type="button">
        <span>${escapeHtml(task.chatTitle)}</span>
        <small>${escapeHtml(task.agentName)} - ${escapeHtml(chatParticipants(task).map(profileName).join(", "))}</small>
      </button>
    `).join("")
    : `<div class="sidebar-empty">No task chats yet.</div>`;
}

function renderChat() {
  const task = activeTask();
  const hasTask = Boolean(task);
  $all("[data-login-user]").forEach((button) => {
    const person = button.dataset.loginUser;
    button.textContent = profileName(person);
    button.classList.toggle("active", person === state.activeUser);
    button.dataset.signedIn = state.auth?.[person]?.signedIn ? "true" : "false";
    button.title = `${loginStateLabel(person)} as ${profileName(person)}`;
  });
  $("#activeAgent").textContent = hasTask ? task.agentName : "Household Executive Agent";
  $("#activeChatTitle").textContent = hasTask ? task.chatTitle : "Start with a task chat";
  $("#inspectorTitle").textContent = hasTask ? task.title : "No task selected";
  $("#chatNameInput").value = hasTask ? task.chatTitle : "";
  $("#agentNameInput").value = hasTask ? task.agentName : "";
  $("#renameChatForm").classList.toggle("muted-form", !hasTask);
  $("#chatInput").disabled = !hasTask;
  $("#chatInput").placeholder = hasTask
    ? `Message as ${profileName(state.activeUser)}`
    : "Message the agent for this task";

  if (!hasTask) {
    $("#chatMessages").innerHTML = `
      <div class="welcome-message">
        <h3>What are we managing first?</h3>
      <p>Create a task chat and CoupleOS will assign an agent, preserve the conversation, and keep reminders attached to that workstream.</p>
      </div>
    `;
    $("#starterPrompts").innerHTML = "";
    $("#participantList").innerHTML = "";
    $("#inspectorBody").innerHTML = emptyState();
    return;
  }

  $("#chatMessages").innerHTML = task.messages.map((message) => `
    <article class="message ${escapeHtml(message.role)} ${message.author ? escapeHtml(message.author) : ""}">
      <div class="avatar">${escapeHtml(messageAvatar(message, task))}</div>
      <div class="message-content">
        <div class="message-meta">${escapeHtml(messageAuthorName(message, task))}</div>
        <div class="message-body">${escapeHtml(message.text)}</div>
      </div>
    </article>
  `).join("");

  $("#starterPrompts").innerHTML = [
    "Connect your calendars",
    "Create your first task or project",
    "Optimize our calendars"
  ].map((prompt) => `<button class="starter" data-prompt="${escapeHtml(prompt)}" type="button">${escapeHtml(prompt)}</button>`).join("");

  $("#inspectorBody").innerHTML = renderInspector(task);
  $("#participantList").innerHTML = renderParticipants(task);
  $("#chatMessages").scrollTop = $("#chatMessages").scrollHeight;
}

function renderParticipants(task) {
  return chatParticipants(task).map((person) => `
    <div class="participant-pill ${person === state.activeUser ? "active" : ""}">
      <span class="participant-avatar">${escapeHtml(initials(profileName(person)))}</span>
      <span>
        <strong>${escapeHtml(profileName(person))}</strong>
        <small>${escapeHtml(person === state.activeUser ? "Current speaker" : loginStateLabel(person))}</small>
      </span>
    </div>
  `).join("");
}

function renderInspector(task) {
  const ownerProfile = task.owner === "both" ? null : state.profiles[task.owner];
  const coaching = ownerProfile
    ? `${profileName(task.owner)} prefers ${ownerProfile.accountabilityTone} accountability with ${ownerProfile.planningStyle}.`
    : "Shared task: name one next-action owner and one support role.";
  const overdue = isTaskPastDue(task);
  const latestAccountability = task.accountabilityLog[0];

  return `
    <div class="inspector-stack">
      <div class="context-row"><span>Status</span><strong>${escapeHtml(overdue ? "overdue" : task.status)}</strong></div>
      <div class="context-row"><span>Owner</span><strong>${escapeHtml(profileName(task.owner))}</strong></div>
      <div class="context-row"><span>Participants</span><strong>${escapeHtml(chatParticipants(task).map(profileName).join(", "))}</strong></div>
      <div class="context-row"><span>Due</span><strong>${escapeHtml(formatDate(task.due))}</strong></div>
      <div class="context-row"><span>Type</span><strong>${escapeHtml(task.category)}</strong></div>
      ${task.project ? `<div class="context-row"><span>Plan</span><strong>${escapeHtml(task.project)}</strong></div>` : ""}
      ${task.recurrence && task.recurrence !== "none" ? `<div class="context-row"><span>Repeats</span><strong>${escapeHtml(recurrenceLabel(task.recurrence))}</strong></div>` : ""}
      ${task.notes ? `<div><h4>Notes</h4><p>${escapeHtml(task.notes)}</p></div>` : ""}
      <div>
        <h4>Agent stance</h4>
        <p>${escapeHtml(coaching)}</p>
      </div>
      <section class="accountability-box ${overdue ? "urgent" : ""}">
        <h4>Reminder process</h4>
        <p>${escapeHtml(overdue ? "This is due and not done. Start outreach and ask whether the owner needs help or is just behind." : "When this becomes past due, CoupleOS can draft the next email, text, or AI phone call.")}</p>
        <div class="context-row"><span>Path</span><strong>${escapeHtml(accountabilityPathLabel(task.accountabilityPath))}</strong></div>
        <div class="context-row"><span>State</span><strong>${escapeHtml(task.accountabilityState)}</strong></div>
        ${latestAccountability ? `<div class="draft-box">${escapeHtml(latestAccountability.draft)}</div>` : ""}
        <div class="card-actions">
          <button class="card-action" data-task-action="accountability" type="button">Run reminder</button>
          <button class="card-action" data-task-action="needs-help" type="button">Needs help</button>
          <button class="card-action" data-task-action="just-behind" type="button">Just behind</button>
        </div>
      </section>
      <div class="card-actions">
        ${task.status !== "done" ? `<button class="card-action" data-task-action="done" type="button">Done</button>` : ""}
        ${task.status !== "stuck" ? `<button class="card-action" data-task-action="stuck" type="button">Stuck</button>` : ""}
        ${task.status !== "open" ? `<button class="card-action" data-task-action="open" type="button">Reopen</button>` : ""}
        <button class="card-action" data-task-action="delete" type="button">Remove</button>
      </div>
    </div>
  `;
}

function accountabilityPathLabel(path) {
  if (path === "all") return "Email, text, then AI call";
  if (path === "text") return "Text first";
  if (path === "call") return "AI call first";
  return "Email first";
}

function renderTasks() {
  $all("[data-filter]").forEach((button) => button.classList.toggle("active", button.dataset.filter === state.activeTaskFilter));
  const tasks = state.tasks.filter((task) => state.activeTaskFilter === "all" || task.status === state.activeTaskFilter);
  $("#taskList").innerHTML = tasks.length ? tasks.map(renderTask).join("") : emptyState();
}

function renderTask(task) {
  const overdue = isTaskPastDue(task);
  return `
    <article class="task-card ${escapeHtml(overdue ? "overdue" : task.status)}">
      <div class="task-top">
        <div>
          <h3 class="task-title">${escapeHtml(task.title)}</h3>
          <div class="meta">${escapeHtml(task.chatTitle)}</div>
        </div>
        <span class="badge ${overdue || task.status === "stuck" ? "clay" : task.status === "done" ? "" : "blue"}">${escapeHtml(overdue ? "overdue" : task.status)}</span>
      </div>
      <div class="badge-row">
        <span class="badge">${escapeHtml(profileName(task.owner))}</span>
        <span class="badge">${escapeHtml(chatParticipants(task).length)} participants</span>
        <span class="badge blue">${escapeHtml(formatDate(task.due))}</span>
        <span class="badge">${escapeHtml(task.category)}</span>
        ${task.project ? `<span class="badge">${escapeHtml(task.project)}</span>` : ""}
        ${task.recurrence && task.recurrence !== "none" ? `<span class="badge">${escapeHtml(recurrenceLabel(task.recurrence))}</span>` : ""}
      </div>
      <p>${escapeHtml(task.notes || (task.project ? task.project : task.category + " task"))}</p>
      <div class="card-actions">
        <button class="card-action" data-task-action="select" data-task-id="${escapeHtml(task.id)}" type="button">Open chat</button>
        ${task.status !== "done" ? `<button class="card-action" data-task-action="done" data-task-id="${escapeHtml(task.id)}" type="button">Done</button>` : ""}
        ${task.status !== "stuck" ? `<button class="card-action" data-task-action="stuck" data-task-id="${escapeHtml(task.id)}" type="button">Stuck</button>` : ""}
        <button class="card-action" data-task-action="delete" data-task-id="${escapeHtml(task.id)}" type="button">Remove</button>
      </div>
    </article>
  `;
}

function renderLearning() {
  $("#learningList").innerHTML = state.learnings.length
    ? state.learnings.map((item) => `
      <article class="learning-card">
        <div class="learning-top">
          <div>
            <h3 class="task-title">${escapeHtml(profileName(item.person))}</h3>
            <p>${escapeHtml(item.signal)}</p>
          </div>
          <span class="badge">${escapeHtml(item.source)}</span>
        </div>
        <div class="meta">${escapeHtml(formatDate(item.createdAt.slice(0, 10)))}</div>
      </article>
    `).join("")
    : emptyState();
}

function emptyState() {
  return $("#emptyTemplate").innerHTML;
}

function toast(message) {
  const existing = $(".toast");
  if (existing) existing.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

init();





















