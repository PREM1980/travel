import { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";

type User = { id: string; email: string; display_name: string };
type Destination = { country: string; city: string };
type Item = {
  day_number: number;
  kind: "visit" | "transport" | "meal" | "stay";
  title: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  estimated_cost?: number;
  notes?: string;
};
type Recommendations = {
  food: string[];
  transport: string[];
  passes: string[];
  weather: string[];
  places: string[];
};
type Plan = {
  id?: string;
  name: string;
  itinerary: Item[];
  recommendations?: Recommendations;
};
type ItineraryResponse = {
  itinerary: Item[];
  recommendations?: Recommendations;
  errors: string[];
};
type DocumentUploadResponse = {
  trip: Trip;
  errors: string[];
  recalculation_error?: string;
  extraction_error?: string;
  date_conflict?: DateConflict;
};
type DateConflict = {
  filename: string;
  document_start_date: string;
  document_end_date: string;
  trip_start_date: string;
  trip_end_date: string;
};
type Trip = {
  id: string;
  name: string;
  start_date?: string;
  end_date?: string;
  adults: number;
  children: number;
  trip_type: string;
  preferences: Record<string, boolean>;
  plan_generated: boolean;
  plans: Plan[];
  active_plan_index: number;
  destinations: Destination[];
  itinerary: Item[];
  documents?: { id: string; filename: string; byte_size: number }[];
};
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  provider?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
};
type ClaudeUsage = { provider: "anthropic"; input_tokens: number; output_tokens: number; message_count: number };
type TripDraft = {
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  adults: number | null;
  children: number | null;
  trip_type: string | null;
  destinations: Destination[];
};
const sameDestinations = (a: Destination[], b: Destination[]): boolean =>
  a.length === b.length &&
  a.every(
    (d, i) =>
      d.country.trim().toLowerCase() === b[i].country.trim().toLowerCase() &&
      d.city.trim().toLowerCase() === b[i].city.trim().toLowerCase(),
  );
const linkifyRecommendation = (value: string) => {
  const url = value.match(/https?:\/\/[^\s,]+/i)?.[0];
  if (!url) return value;
  const [before, after] = value.split(url);
  return <>{before}<a href={url} target="_blank" rel="noreferrer">{url}</a>{after}</>;
};
const VALIDATION_FIELD_LABELS: Record<string, string> = { name: "Trip name" };
const describeValidationEntry = (entry: unknown): string => {
  if (!entry || typeof entry !== "object") return JSON.stringify(entry);
  const { loc, msg, type } = entry as { loc?: unknown[]; msg?: unknown; type?: unknown };
  const field = Array.isArray(loc) ? loc[loc.length - 1] : undefined;
  const label = typeof field === "string" ? VALIDATION_FIELD_LABELS[field] : undefined;
  if (label && (type === "string_too_short" || type === "missing"))
    return `${label} is missing`;
  return typeof msg === "string" ? msg : JSON.stringify(entry);
};
const describeApiError = (detail: unknown): string => {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(describeValidationEntry).join("; ");
  return JSON.stringify(detail);
};
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok)
    throw new Error(
      describeApiError(
        (await res.json().catch(() => ({ detail: res.statusText }))).detail,
      ),
    );
  return res.status === 204 ? (undefined as T) : res.json();
};
const blank = (): Omit<Trip, "id" | "documents"> => ({
  name: "",
  start_date: "2027-04-02",
  end_date: "2027-04-06",
  adults: 2,
  children: 2,
  trip_type: "family",
  destinations: [{ country: "", city: "" }],
  preferences: { food: true, transport: true, tips: true, passes: true },
  plan_generated: false,
  plans: [],
  active_plan_index: 0,
  itinerary: [],
});
const emptyRecommendations = (): Recommendations => ({
  food: [],
  transport: [],
  passes: [],
  weather: [],
  places: [],
});
const tripEssentials = [
  ["Documents & reservations", ["Passport or government ID, plus required visas", "Flight, train, ferry, and accommodation confirmations", "Travel insurance policy, emergency assistance number, and policy details", "Digital and printed copies of key documents stored separately", "Driving licence, vehicle documents, and international driving permit if needed"]],
  ["Money & safety", ["Two payment methods kept separately", "Small amount of local currency for arrival costs", "Bank travel notice or confirmed card access abroad", "Emergency contacts shared with a trusted person", "Destination entry, local safety, and emergency-number information"]],
  ["Health & wellbeing", ["Prescription medicines in original labelled containers", "Basic first-aid kit and any needed medical devices", "Doctor note or medication documentation when required", "Vaccination, allergy, and accessibility information", "Refill medicines and pack them in carry-on luggage"]],
  ["Bags & clothing", ["Weather-appropriate layers and a rain or sun option", "Comfortable walking shoes plus one alternate pair", "Underwear, sleepwear, and a compact laundry plan", "Swimwear, formalwear, or activity-specific clothing if planned", "Day bag, reusable water bottle, and packing cubes or bags"]],
  ["Technology", ["Phone, charger, power bank, and charging cable", "Destination plug adapter and voltage-compatible devices", "Offline maps, boarding passes, and key reservation files", "Mobile data plan, eSIM, or roaming plan", "Headphones and a small tracker for checked luggage"]],
  ["Travel day", ["Passport, tickets, wallet, and phone together in carry-on", "Arrival transport plan and accommodation address saved offline", "Snacks, water, and comfort items for the journey", "Entertainment and a change of clothes for long journeys", "Allow time for check-in, security, transfers, and immigration"]],
  ["Home & pets", ["Secure doors, windows, appliances, and valuables", "Pause deliveries or arrange mail collection", "Share itinerary and check-in plan with a trusted contact", "Pet or plant care instructions and access arrangements", "Set lights, thermostat, and waste collection plans"]],
  ["Destination-specific", ["Check seasonal weather and local cultural expectations", "Reserve high-demand attractions and restaurants", "Confirm luggage rules for airlines, rail, and attractions", "Download local transit apps and check pass eligibility", "Review child, accessibility, dietary, or mobility needs"]],
] as const;

const withActiveItinerary = <T extends Omit<Trip, "id" | "documents"> | Trip>(
  trip: T,
  itinerary: Item[],
): T => {
  const plans = trip.plans.length
    ? trip.plans.map((plan, index) =>
        index === trip.active_plan_index ? { ...plan, itinerary } : plan,
      )
    : [{ name: "Plan 1", itinerary }];
  const active_plan_index = Math.min(trip.active_plan_index, plans.length - 1);
  return { ...trip, itinerary, plans, active_plan_index };
};

function App() {
  const [user, setUser] = useState<User | null>(null),
    [trip, setTrip] = useState<Omit<Trip, "id" | "documents"> | Trip>(blank()),
    [trips, setTrips] = useState<
      Pick<Trip, "id" | "name" | "start_date" | "end_date">[]
    >([]),
    [auth, setAuth] = useState<"login" | "register">("login"),
    [error, setError] = useState(""),
    [conversation, setConversation] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    // Dates and travelers start pre-filled with plausible-looking defaults (so the
    // form is usable without touching every field), which means their raw values
    // can't tell "the user really wants this" apart from "never touched, still the
    // factory default." Chat needs that distinction to know whether it has actually
    // gathered this information yet, so it's tracked explicitly here instead.
    [chatConfirmed, setChatConfirmed] = useState({ dates: false, travelers: false }),
    [chat, setChat] = useState(""),
    [uploadName, setUploadName] = useState(""),
    [documentError, setDocumentError] = useState(""),
    [dateConflict, setDateConflict] = useState<DateConflict | null>(null),
    [showValidation, setShowValidation] = useState(false),
    [recommendationTab, setRecommendationTab] =
      useState<keyof Recommendations>("food"),
    [recommendationsExpanded, setRecommendationsExpanded] = useState(true),
    [chatMode, setChatMode] = useState<"open" | "closed">("open"),
    [assistantWidth, setAssistantWidth] = useState<number | null>(() => {
      try {
        const stored = Number(localStorage.getItem("assistantWidth"));
        return stored > 0 ? stored : null;
      } catch {
        return null;
      }
    }),
    [isGenerating, setIsGenerating] = useState(false),
    [isReconciling, setIsReconciling] = useState(false),
    [isExporting, setIsExporting] = useState<"pdf" | "xlsx" | null>(null),
    [scheduleWarnings, setScheduleWarnings] = useState<string[]>([]),
    [collapsedDays, setCollapsedDays] = useState<Set<number>>(() => new Set()),
    [draggedItem, setDraggedItem] = useState<number | null>(null),
    [dropTarget, setDropTarget] = useState<number | null>(null),
    [claudeUsage, setClaudeUsage] = useState<ClaudeUsage | null>(null),
    [view, setView] = useState<"planner" | "trips" | "essentials" | "settings">(() =>
      window.location.pathname === "/trips" ? "trips" : window.location.pathname === "/essentials" ? "essentials" : window.location.pathname === "/settings" ? "settings" : "planner",
    );
  const draggedItemRef = useRef<number | null>(null);
  const assistantRef = useRef<HTMLElement | null>(null);
  const startAssistantResize = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = assistantRef.current?.getBoundingClientRect().width ?? 380;
    const onMove = (moveEvent: MouseEvent) => {
      const next = startWidth + (startX - moveEvent.clientX);
      const clamped = Math.min(Math.max(next, 320), Math.min(720, window.innerWidth * 0.6));
      setAssistantWidth(clamped);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setAssistantWidth((width) => {
        try {
          if (width) localStorage.setItem("assistantWidth", String(width));
        } catch {
          // Browser storage can be unavailable (private mode, blocked site data);
          // the resize still works for this session even if it isn't remembered.
        }
        return width;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const loadTrips = async () =>
    setTrips(
      await api<Pick<Trip, "id" | "name" | "start_date" | "end_date">[]>(
        "/trips",
      ),
    );
  useEffect(() => {
    api<User>("/auth/me")
      .then((u) => {
        setUser(u);
        loadTrips();
      })
      .catch(() => undefined);
  }, []);
  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const u = await api<User>(`/auth/${auth}`, {
        method: "POST",
        body: JSON.stringify({
          email: f.get("email"),
          password: f.get("password"),
          display_name: f.get("display_name") || "Traveler",
        }),
      });
      setUser(u);
      setError("");
      loadTrips();
    } catch (x) {
      setError((x as Error).message);
    }
  };
  const update = (key: string, value: unknown) => {
    if (key === "itinerary") setScheduleWarnings([]);
    setTrip((t) =>
      key === "itinerary"
        ? withActiveItinerary(t, value as Item[])
        : { ...t, [key]: value },
    );
  };
  const save = async () => {
    try {
      const existing = "id" in trip ? trip.id : null;
      const saved = await api<Trip>(
        existing ? `/trips/${existing}` : "/trips",
        { method: existing ? "PUT" : "POST", body: JSON.stringify(trip) },
      );
      setTrip(saved);
      await loadTrips();
      setError("");
    } catch (x) {
      setError((x as Error).message);
    }
  };
  const downloadPlan = async (format: "pdf" | "xlsx") => {
    if (!trip.itinerary.length) {
      setError("Add activities to the selected plan before downloading it.");
      return;
    }
    setIsExporting(format);
    setError("");
    try {
      const response = await fetch(`/api/exports/${format}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trip),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(body.detail);
      }
      const filename = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1]
        || `travel-itinerary.${format}`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setIsExporting(null);
    }
  };
  const chooseTrip = async (id: string) => {
    const found = await api<Trip>(`/trips/${id}`);
    setTrip(found);
    setScheduleWarnings([]);
    setChatConfirmed({ dates: false, travelers: false });
    const chats = await api<{ id: string }[]>(`/trips/${id}/conversations`);
    const latest = chats[0];
    setConversation(latest?.id || null);
    setMessages(
      latest
        ? await api<Message[]>(`/conversations/${latest.id}/messages`)
        : [],
    );
    setView("planner");
    window.history.pushState({}, "", "/");
  };
  const showTrips = () => {
    setView("trips");
    window.history.pushState({}, "", "/trips");
  };
  const showEssentials = () => {
    setView("essentials");
    window.history.pushState({}, "", "/essentials");
  };
  const showSettings = async () => {
    setView("settings");
    window.history.pushState({}, "", "/settings");
    try {
      setClaudeUsage(await api<ClaudeUsage>("/settings/usage"));
      setError("");
    } catch (x) {
      setError((x as Error).message);
    }
  };
  const deleteTrip = async (savedTrip: Pick<Trip, "id" | "name">) => {
    if (
      !window.confirm(
        `Delete “${savedTrip.name}”? This permanently removes its itinerary, uploads, and conversations.`,
      )
    )
      return;
    try {
      await api<void>(`/trips/${savedTrip.id}`, { method: "DELETE" });
      if ("id" in trip && trip.id === savedTrip.id) {
        setTrip(blank());
        setMessages([]);
        setConversation(null);
        setChatConfirmed({ dates: false, travelers: false });
      }
      await loadTrips();
      setError("");
    } catch (x) {
      setError((x as Error).message);
    }
  };
  const appendDestination = () =>
    update("destinations", [...trip.destinations, { country: "", city: "" }]);
  const setDestination = (
    index: number,
    key: keyof Destination,
    value: string,
  ) =>
    update(
      "destinations",
      trip.destinations.map((d, i) =>
        i === index ? { ...d, [key]: value } : d,
      ),
    );
  const addItem = (dayNumber?: number) =>
    update("itinerary", [
      ...trip.itinerary,
      {
        day_number:
          dayNumber ??
          Math.max(1, ...trip.itinerary.map((i) => i.day_number)) + 1,
        kind: "visit",
        title: "New activity",
      },
    ]);
  const canGenerateRandomPlan = Boolean(
    trip.name.trim() &&
    trip.start_date &&
    trip.end_date &&
    trip.start_date <= trip.end_date &&
    trip.adults >= 1 &&
    trip.children >= 0 &&
    trip.trip_type &&
    trip.destinations.length &&
    trip.destinations.every(
      (destination) => destination.country.trim() && destination.city.trim(),
    ),
  );
  const invalidDateRange = Boolean(
    trip.start_date && trip.end_date && trip.start_date > trip.end_date,
  );
  const fieldInvalid = {
    name: showValidation && !trip.name.trim(),
    startDate: showValidation && (!trip.start_date || invalidDateRange),
    endDate: showValidation && (!trip.end_date || invalidDateRange),
    destination: (index: number) => ({
      country: showValidation && !trip.destinations[index].country.trim(),
      city: showValidation && !trip.destinations[index].city.trim(),
    }),
  };
  const missingFieldLabels = (
    t: Omit<Trip, "id" | "documents"> | Trip,
    confirmed: { dates: boolean; travelers: boolean } = { dates: false, travelers: false },
  ): string[] => {
    const defaults = blank();
    const labels: string[] = [];
    if (!t.name.trim()) labels.push("trip name");
    const datesLookUnset =
      !t.start_date ||
      !t.end_date ||
      t.start_date > t.end_date ||
      (t.start_date === defaults.start_date && t.end_date === defaults.end_date);
    if (datesLookUnset && !confirmed.dates) labels.push("dates");
    if (
      !t.destinations.length ||
      t.destinations.some((d) => !d.country.trim() || !d.city.trim())
    )
      labels.push("destination (country and city)");
    const travelersLookUnset = t.adults === defaults.adults && t.children === defaults.children;
    if (travelersLookUnset && !confirmed.travelers) labels.push("number of travelers");
    return labels;
  };
  const dayDateLabel = (dayNumber: number): string => {
    if (!trip.start_date) return "";
    const [year, month, day] = trip.start_date.split("-").map(Number);
    const date = new Date(year, month - 1, day + (dayNumber - 1));
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };
  const itineraryDays = Array.from(
    trip.itinerary
      .map((item, index) => ({ ...item, index }))
      .reduce((days, item) => {
        const activities = days.get(item.day_number) || [];
        activities.push(item);
        days.set(item.day_number, activities);
        return days;
      }, new Map<number, Array<Item & { index: number }>>())
      .entries(),
  ).sort(([leftDay], [rightDay]) => leftDay - rightDay);
  const toggleDay = (dayNumber: number) =>
    setCollapsedDays((days) => {
      const next = new Set(days);
      if (next.has(dayNumber)) next.delete(dayNumber);
      else next.add(dayNumber);
      return next;
    });
  const agentIsWorking = isGenerating || isReconciling;
  const agentStatus = isGenerating
    ? "Generating your itinerary with the planning agent… Your ONE week work done in 2 mins..so relax..."
    : isReconciling
      ? "Updating the activity order and validating the schedule…"
      : scheduleWarnings.length
        ? "Agent completed the plan with unresolved planning issues."
        : "Agent is ready to plan or update your itinerary.";
  const activeRecommendations = {
    ...emptyRecommendations(),
    ...trip.plans[trip.active_plan_index]?.recommendations,
  };
  const generateRandomPlan = async () => {
    if (!canGenerateRandomPlan) {
      setShowValidation(true);
      setError(
        "Complete the trip details, dates, travelers, trip type, and a country/city destination before generating a plan.",
      );
      return;
    }
    setIsGenerating(true);
    try {
      const generated = await api<ItineraryResponse>("/itineraries/generate", {
        method: "POST",
        body: JSON.stringify(trip),
      });
      const plans = [
        ...trip.plans,
        {
          name: `Plan ${trip.plans.length + 1}`,
          itinerary: generated.itinerary,
          recommendations: generated.recommendations ?? emptyRecommendations(),
        },
      ];
      const generatedTrip = {
        ...trip,
        plans,
        active_plan_index: plans.length - 1,
        itinerary: generated.itinerary,
        plan_generated: true,
      };
      // Every generated alternative is durable immediately, so switching
      // between plans never loses a newly generated itinerary.
      const saved = await api<Trip>(
        "id" in trip ? `/trips/${trip.id}` : "/trips",
        {
          method: "id" in trip ? "PUT" : "POST",
          body: JSON.stringify(generatedTrip),
        },
      );
      setTrip(saved);
      await loadTrips();
      setScheduleWarnings(generated.errors);
      setError("");
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };
  const setItem = (index: number, key: keyof Item, value: string | number) =>
    update(
      "itinerary",
      trip.itinerary.map((i, n) => (n === index ? { ...i, [key]: value } : i)),
    );
  const moveItem = (index: number, targetIndex: number, targetDay: number) => {
    const itinerary = [...trip.itinerary];
    const [moved] = itinerary.splice(index, 1);
    itinerary.splice(targetIndex, 0, { ...moved, day_number: targetDay });
    const reorderedTrip = withActiveItinerary(trip, itinerary);
    setIsReconciling(true);
    api<ItineraryResponse>("/itineraries/reconcile", {
      method: "POST",
      body: JSON.stringify(reorderedTrip),
    })
      .then(({ itinerary: reconciled, errors }) => {
        setTrip(withActiveItinerary(reorderedTrip, reconciled));
        setScheduleWarnings(errors);
        setError("");
      })
      .catch((x) => {
        setError(
          `The agent could not update the plan, so the activity order was not changed: ${(x as Error).message}`,
        );
      })
      .finally(() => setIsReconciling(false));
  };
  const chatSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const content = chat.trim();
    if (!content) return;
    const tripComplete = canGenerateRandomPlan;
    setChat("");
    setMessages((m) => [
      ...m,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      },
    ]);
    const reply = (text: string) =>
      setMessages((m) => [
        ...m,
        {
          id: `local-${Date.now()}-a`,
          role: "assistant",
          content: text,
          created_at: new Date().toISOString(),
        },
      ]);
    // Only treat this as trip setup while the trip is still incomplete. Once it's
    // complete, every message goes straight to the real concierge question below —
    // never through the extractor — so a genuine question can never be misread as
    // a restatement just because it happens to mention a place, date, or traveler
    // count. The trade-off: a paraphrased restatement sent *after* completion is no
    // longer caught as a repeat; it's just answered as a normal question instead.
    if (!tripComplete) {
      let draft: TripDraft;
      try {
        draft = await api<TripDraft>("/trips/parse", {
          method: "POST",
          body: JSON.stringify({ content }),
        });
      } catch (x) {
        reply(`I couldn't read the trip details from that message: ${(x as Error).message}`);
        return;
      }
      const draftHasContent = Boolean(
        draft.name ||
          draft.start_date ||
          draft.end_date ||
          draft.adults != null ||
          draft.children != null ||
          draft.trip_type ||
          draft.destinations.length,
      );
      if (!draftHasContent) {
        reply(`I didn't find any trip details in that message. Still needed: ${missingFieldLabels(trip, chatConfirmed).join(", ")}.`);
        return;
      }
      // A date range or traveler count stated in this message is confirmed
      // information even if it happens to match the trip's untouched default
      // values (e.g. "2 adults, 2 kids") — see chatConfirmed's declaration above.
      const nextConfirmed = {
        dates: chatConfirmed.dates || Boolean(draft.start_date && draft.end_date),
        travelers: chatConfirmed.travelers || draft.adults != null,
      };
      if (nextConfirmed.dates !== chatConfirmed.dates || nextConfirmed.travelers !== chatConfirmed.travelers) {
        setChatConfirmed(nextConfirmed);
      }
      // A brand-new, never-saved trip only has placeholder defaults, so a chat
      // description may freely set every field; once a trip has been saved, only
      // fill whatever is still genuinely blank so a message never clobbers
      // something already set (by chat or by hand). "changed" only flips when a
      // field's value actually differs from what's already on the trip, so a
      // reworded repeat that resolves to the same facts is recognized as such.
      const isFreshTrip = !("id" in trip);
      const merged = { ...trip, destinations: trip.destinations };
      let changed = false;
      // Unlike the other fields, name can be invented by the model rather than
      // extracted verbatim, so its wording can vary between calls even for the
      // same trip. Only ever set it once, while it's still blank, so re-describing
      // the trip later never flickers the name to a different phrasing.
      if (draft.name && !merged.name.trim()) {
        merged.name = draft.name;
        changed = true;
      }
      if (draft.start_date && draft.start_date !== merged.start_date && (isFreshTrip || !merged.start_date)) {
        merged.start_date = draft.start_date;
        changed = true;
      }
      if (draft.end_date && draft.end_date !== merged.end_date && (isFreshTrip || !merged.end_date)) {
        merged.end_date = draft.end_date;
        changed = true;
      }
      if (isFreshTrip && draft.adults != null && draft.adults !== merged.adults) {
        merged.adults = draft.adults;
        changed = true;
      }
      if (isFreshTrip && draft.children != null && draft.children !== merged.children) {
        merged.children = draft.children;
        changed = true;
      }
      if (isFreshTrip && draft.trip_type && draft.trip_type !== merged.trip_type) {
        merged.trip_type = draft.trip_type;
        changed = true;
      }
      const hasDestination = merged.destinations.some((d) => d.country.trim() && d.city.trim());
      if (
        draft.destinations.length &&
        (isFreshTrip || !hasDestination) &&
        !sameDestinations(draft.destinations, merged.destinations)
      ) {
        merged.destinations = draft.destinations;
        changed = true;
      }
      if (changed) setTrip(merged);
      const stillMissing = missingFieldLabels(changed ? merged : trip, nextConfirmed);
      reply(
        !changed
          ? `This plan is already in progress; that message didn't add anything new. Still needed: ${stillMissing.join(", ")}.`
          : stillMissing.length
            ? `Got it — I've updated the trip details from your message. Still needed: ${stillMissing.join(", ")}.`
            : `All set! I've filled in the trip details from your message — click "Generate a random plan" whenever you're ready.`,
      );
      return;
    }
    if (!("id" in trip)) {
      reply(
        `Your trip details look ready — save the trip or click "Generate a random plan" to build the itinerary, then I can help with questions about it.`,
      );
      return;
    }
    try {
      let id = conversation;
      if (!id) {
        const c = await api<{ id: string }>(`/trips/${trip.id}/conversations`, {
          method: "POST",
        });
        id = c.id;
        setConversation(id);
      }
      const out = await api<{ answer: string; provider?: string; model?: string; input_tokens?: number; output_tokens?: number }>(
        `/trips/${trip.id}/conversations/${id}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setMessages((m) => [
        ...m,
        {
          id: `local-${Date.now()}`,
          role: "assistant",
          content: out.answer,
          created_at: new Date().toISOString(),
          provider: out.provider,
          model: out.model,
          input_tokens: out.input_tokens,
          output_tokens: out.output_tokens,
        },
      ]);
    } catch (x) {
      setError((x as Error).message);
    }
  };
  const upload = async (e: FormEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const displayName = uploadName.trim() || file.name;
    setIsGenerating(true);
    setError("");
    setDocumentError("");
    const data = new FormData();
    data.append("document", file);
    data.append("filename", displayName);
    try {
      // Date validation runs on the server, so persist pending form edits first,
      // creating the trip if it hasn't been saved yet.
      const existing = "id" in trip ? trip.id : null;
      const savedTrip = await api<Trip>(
        existing ? `/trips/${existing}` : "/trips",
        { method: existing ? "PUT" : "POST", body: JSON.stringify(trip) },
      );
      setTrip(savedTrip);
      const res = await fetch(`/api/trips/${savedTrip.id}/documents`, {
        method: "POST",
        credentials: "include",
        body: data,
      });
      const uploaded = await res.json().catch(() => ({}));
      if (res.status === 413) throw new Error("Files must be 10 MB or smaller.");
      if (!res.ok)
        throw new Error(
          uploaded.detail ? describeApiError(uploaded.detail) : "Unable to upload document",
        );
      const result = uploaded as DocumentUploadResponse;
      setTrip(result.trip);
      setScheduleWarnings(result.errors);
      setDocumentError(
        [result.extraction_error, result.recalculation_error].filter(Boolean).join(" "),
      );
      setDateConflict(result.date_conflict || null);
      setUploadName("");
      setMessages((m) => [
        ...m,
        {
          id: `local-${Date.now()}`,
          role: "user",
          content: `📎 Attached "${displayName}"`,
          created_at: new Date().toISOString(),
        },
      ]);
      await loadTrips();
    } catch (x) {
      setDocumentError((x as Error).message);
      setShowValidation(true);
    } finally {
      input.value = "";
      setIsGenerating(false);
    }
  };
  const deleteDocument = async (document: { id: string; filename: string }) => {
    if (!("id" in trip) || !window.confirm(`Delete “${document.filename}”? This cannot be undone.`)) return;
    setIsGenerating(true);
    setDocumentError("");
    try {
      const result = await api<DocumentUploadResponse>(`/trips/${trip.id}/documents/${document.id}`, { method: "DELETE" });
      setTrip(result.trip);
      setScheduleWarnings(result.errors);
      setDateConflict(null);
      setDocumentError(result.recalculation_error || "");
      await loadTrips();
    } catch (x) {
      setDocumentError((x as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };
  if (!user)
    return (
      <main className="landing">
        <section className="hero">
          <p className="eyebrow">TRAVEL PLANNER</p>
          <h1>
            Plan your trip
            <br />
            efficiently.
          </h1>
          <p className="lead">
            Build a thoughtful itinerary, keep reservations together, and ask
            for recommendations as you plan.
          </p>
          <div className="feature-grid">
            {[
              ["◎", "Places to visit"],
              ["⌂", "Accommodation"],
              ["✦", "Food"],
              ["→", "Transport"],
            ].map(([icon, label]) => (
              <div className="feature" key={label}>
                <span>{icon}</span>
                {label}
              </div>
            ))}
          </div>
        </section>
        <section className="auth">
          <div className="card">
            <p className="eyebrow">WELCOME</p>
            <h2>
              {auth === "login"
                ? "Sign in to your trips"
                : "Create your account"}
            </h2>
            <form onSubmit={login}>
              {auth === "register" && (
                <label>
                  Name
                  <input name="display_name" required placeholder="Your name" />
                </label>
              )}
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  placeholder="At least 8 characters"
                />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="primary">
                {auth === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
            <button
              className="link"
              onClick={() =>
                setAuth((a) => (a === "login" ? "register" : "login"))
              }
            >
              {auth === "login"
                ? "New here? Create an account"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </section>
      </main>
    );
  if (view === "trips")
    return (
      <main className="app">
        <header>
          <div>
            <p className="eyebrow">TRAVEL PLANNER</p>
            <strong>Welcome, {user.display_name}</strong>
          </div>
          <div className="header-actions">
            <button
              onClick={() => {
                setView("planner");
                window.history.pushState({}, "", "/");
              }}
            >
              Plan a trip
            </button>
            <button onClick={showEssentials}>Essentials</button>
            <button onClick={showSettings}>Settings</button>
            <button
              onClick={async () => {
                await api("/auth/logout", { method: "POST" });
                setUser(null);
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        {error && <p className="error banner">{error}</p>}
        <section className="trips-page">
          <div className="section-head">
            <div>
              <p className="eyebrow">YOUR TRIPS</p>
              <h1>All saved trips</h1>
            </div>
            <button
              className="primary"
              onClick={() => {
                setTrip(blank());
                setMessages([]);
                setConversation(null);
                setChatConfirmed({ dates: false, travelers: false });
                setView("planner");
                window.history.pushState({}, "", "/");
              }}
            >
              New trip
            </button>
          </div>
          {trips.length === 0 ? (
            <p className="empty">You have not saved any trips yet.</p>
          ) : (
            <div className="trip-cards">
              {trips.map((savedTrip) => (
                <div className="trip-card" key={savedTrip.id}>
                  <button
                    className="trip-open"
                    onClick={() => chooseTrip(savedTrip.id)}
                  >
                    <strong>{savedTrip.name}</strong>
                    <span>
                      {savedTrip.start_date && savedTrip.end_date
                        ? `${savedTrip.start_date} — ${savedTrip.end_date}`
                        : "Dates not set"}
                    </span>
                  </button>
                  <button
                    className="trip-delete"
                    onClick={() => deleteTrip(savedTrip)}
                    aria-label={`Delete ${savedTrip.name}`}
                  >
                    Delete trip
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    );
  if (view === "essentials")
    return (
      <main className="app">
        <header>
          <div><p className="eyebrow">TRAVEL PLANNER</p><strong>Welcome, {user.display_name}</strong></div>
          <div className="header-actions">
            <button onClick={() => { setView("planner"); window.history.pushState({}, "", "/"); }}>Plan a trip</button>
            <button onClick={showTrips}>My trips</button>
            <button onClick={showSettings}>Settings</button>
            <button onClick={async () => { await api("/auth/logout", { method: "POST" }); setUser(null); }}>Sign out</button>
          </div>
        </header>
        <section className="essentials-page">
          <p className="eyebrow">TRIP PREP</p>
          <h1>Travel essentials checklist</h1>
          <p className="essentials-intro">Use this as a practical starting point, then tailor it to your destination, season, itinerary, and personal needs.</p>
          <div className="essentials-grid">
            {tripEssentials.map(([category, items]) => (
              <section className="essentials-card" key={category}>
                <h2>{category}</h2>
                <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ))}
          </div>
        </section>
      </main>
    );
  if (view === "settings")
    return (
      <main className="app">
        <header>
          <div><p className="eyebrow">TRAVEL PLANNER</p><strong>Welcome, {user.display_name}</strong></div>
          <div className="header-actions">
            <button onClick={() => { setView("planner"); window.history.pushState({}, "", "/"); }}>Plan a trip</button>
            <button onClick={showTrips}>My trips</button>
            <button onClick={showEssentials}>Essentials</button>
            <button onClick={async () => { await api("/auth/logout", { method: "POST" }); setUser(null); }}>Sign out</button>
          </div>
        </header>
        {error && <p className="error banner">{error}</p>}
        <section className="settings-page">
          <p className="eyebrow">SETTINGS</p>
          <h1>Claude usage</h1>
          <p className="settings-intro">Usage is recorded from Claude API responses for this account's chat messages.</p>
          <div className="usage-grid" aria-label="Claude token usage">
            <section><span>Input tokens</span><strong>{claudeUsage?.input_tokens.toLocaleString() ?? "—"}</strong></section>
            <section><span>Output tokens</span><strong>{claudeUsage?.output_tokens.toLocaleString() ?? "—"}</strong></section>
            <section><span>Claude responses</span><strong>{claudeUsage?.message_count.toLocaleString() ?? "—"}</strong></section>
          </div>
          <p className="empty">No estimated token counts are used; totals only include usage returned by the Claude SDK.</p>
        </section>
      </main>
    );
  return (
    <main className="app">
      <header>
        <div>
          <p className="eyebrow">TRAVEL PLANNER</p>
          <strong>Welcome, {user.display_name}</strong>
        </div>
        <div className="header-actions">
          <button onClick={showTrips}>My trips</button>
          <button onClick={showEssentials}>Essentials</button>
          <button onClick={showSettings}>Settings</button>
          <button
            onClick={() => {
              setTrip(blank());
              setMessages([]);
              setConversation(null);
              setChatConfirmed({ dates: false, travelers: false });
            }}
          >
            New trip
          </button>
          <button
            onClick={async () => {
              await api("/auth/logout", { method: "POST" });
              setUser(null);
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {error && <p className="error banner">{error}</p>}
      <div
        className={`workspace chat-${chatMode}`}
        style={
          assistantWidth && chatMode === "open"
            ? ({ "--assistant-col": `${assistantWidth}px` } as CSSProperties)
            : undefined
        }
      >
        <section className="planner">
          <div className="section-head">
            <div>
              <p className="eyebrow">YOUR ITINERARY</p>
              <h1>Make the most of every day.</h1>
            </div>
            <div className="plan-actions">
              {trip.plans.length < 5 && (
                <button
                  className="random"
                  onClick={generateRandomPlan}
                  disabled={!canGenerateRandomPlan || isGenerating}
                >
                  ✦{" "}
                  {isGenerating
                    ? "Agent is working…"
                    : trip.plans.length
                      ? `Generate plan ${trip.plans.length + 1}`
                      : "Generate a random plan"}
                </button>
              )}
              <button className="primary" onClick={save}>
                Save trip
              </button>
              <div className="export-actions" aria-label="Download selected plan">
                <button
                  className="secondary"
                  onClick={() => downloadPlan("pdf")}
                  disabled={!trip.itinerary.length || isExporting !== null}
                >
                  {isExporting === "pdf" ? "Preparing PDF…" : "Download PDF"}
                </button>
                <button
                  className="secondary"
                  onClick={() => downloadPlan("xlsx")}
                  disabled={!trip.itinerary.length || isExporting !== null}
                >
                  {isExporting === "xlsx" ? "Preparing Excel…" : "Download Excel"}
                </button>
              </div>
            </div>
          </div>
          {agentIsWorking && (
            <div className="agent-status working" role="status" aria-live="polite">
              <span className="agent-status-dot" aria-hidden="true" />
              <strong>Agent is working</strong>
              <span>{agentStatus}</span>
            </div>
          )}
          {trip.plans.length > 0 && (
            <div
              className="plan-selector top-plan-selector"
              aria-label="Choose itinerary plan"
            >
              <span>Plans</span>
              {trip.plans.map((plan, index) => (
                <button
                  className={
                    index === trip.active_plan_index ? "selected-plan" : ""
                  }
                  key={plan.name}
                  onClick={() =>
                    setTrip({
                      ...trip,
                      active_plan_index: index,
                      itinerary: plan.itinerary,
                    })
                  }
                >
                  {plan.name}
                </button>
              ))}
              <small>
                {trip.plans.length}/5 plans — generated plans save automatically;
                edits require Save trip
              </small>
            </div>
          )}
          {trip.plans.length > 0 && (
            <section
              className="recommendation-tabs"
              aria-label="Plan recommendations"
            >
              <div className="recommendation-tabs-head">
                <h2>Plan recommendations</h2>
                <div className="recommendation-tabs-actions">
                  <span>Generated for the selected plan</span>
                  <button
                    type="button"
                    className="recommendation-toggle"
                    aria-expanded={recommendationsExpanded}
                    aria-controls="plan-recommendations-content"
                    onClick={() => setRecommendationsExpanded((expanded) => !expanded)}
                  >
                    {recommendationsExpanded ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <div id="plan-recommendations-content" hidden={!recommendationsExpanded}>
                <div className="recommendation-tab-list" role="tablist">
                  {(
                    [
                      ["food", "Food"],
                      ["transport", "Transport"],
                      ["passes", "Popular travel passes"],
                      ["weather", "Weather"],
                      ["places", "Top 20 places"],
                    ] as Array<[keyof Recommendations, string]>
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={recommendationTab === key}
                      className={recommendationTab === key ? "active" : ""}
                      onClick={() => setRecommendationTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="recommendation-content" role="tabpanel">
                  {activeRecommendations[recommendationTab].length ? (
                    <ul>
                      {activeRecommendations[recommendationTab].slice(0, recommendationTab === "places" ? 20 : undefined).map(
                        (recommendation) => (
                          <li key={recommendation}>{linkifyRecommendation(recommendation)}</li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <p>No recommendations were returned for this category.</p>
                  )}
                </div>
              </div>
            </section>
          )}
          {trip.plans.length === 0 && !canGenerateRandomPlan && (
            <div className="generation-hint" role="status">
              <span aria-hidden="true">ⓘ</span>
              <div>
                <strong>Itinerary details needed</strong>
                <p>
                  Add the trip name, dates, travelers, trip type, and at least
                  one country and city to enable generation.
                </p>
              </div>
            </div>
          )}
          <div className="form-grid">
            <label className="wide">
              Trip name
              <input
                value={trip.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Summer in Italy"
                className={fieldInvalid.name ? "invalid" : ""}
                aria-invalid={fieldInvalid.name}
              />
            </label>
            <label>
              From
              <input
                type="date"
                value={trip.start_date || ""}
                onChange={(e) => update("start_date", e.target.value)}
                className={fieldInvalid.startDate ? "invalid" : ""}
                aria-invalid={fieldInvalid.startDate}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={trip.end_date || ""}
                onChange={(e) => update("end_date", e.target.value)}
                className={fieldInvalid.endDate ? "invalid" : ""}
                aria-invalid={fieldInvalid.endDate}
              />
            </label>
            <label>
              Adults
              <input
                type="number"
                min="1"
                value={trip.adults}
                onChange={(e) => update("adults", +e.target.value)}
              />
            </label>
            <label>
              Kids
              <input
                type="number"
                min="0"
                value={trip.children}
                onChange={(e) => update("children", +e.target.value)}
              />
            </label>
            <label>
              Trip type
              <select
                value={trip.trip_type}
                onChange={(e) => update("trip_type", e.target.value)}
              >
                {["family", "adult", "outdoors", "mixed", "automatic"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          <section className="documents-panel" aria-label="Trip documents">
              <div>
                <h2>Travel documents</h2>
                <p>Upload tickets, reservations, or other trip files.</p>
              </div>
              <div className="upload-controls">
                <label>
                  File name
                  <input
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder="Use original file name"
                  />
                </label>
                <label className="file-picker">
                  Choose file
                  <input type="file" onChange={upload} disabled={isGenerating} />
                </label>
              </div>
              {"id" in trip && trip.documents?.length ? (
                <ul className="document-list">
                  {trip.documents.map((document) => (
                    <li key={document.id}>
                      <span>{document.filename}</span>
                      <button type="button" className="document-delete" onClick={() => deleteDocument(document)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div
                  className="schedule-warnings document-warning"
                  role="alert"
                >
                  <strong>
                    Travel documents needed for effective planning
                  </strong>
                  <ul>
                    <li>Flight reservations or boarding documents</li>
                    <li>Train tickets or rail reservations</li>
                    <li>Hotel or other accommodation reservations</li>
                    <li>Travel, transport, or sightseeing passes</li>
                  </ul>
                </div>
              )}
              {dateConflict && (
                <div className="schedule-warnings document-warning" role="alert">
                  <strong>Date conflict found</strong>
                  <p>
                    {dateConflict.filename} covers {dateConflict.document_start_date} to {dateConflict.document_end_date},
                    while this trip is {dateConflict.trip_start_date} to {dateConflict.trip_end_date}.
                  </p>
                  <p>Review the reservation and update the trip dates only if the booking is correct.</p>
                </div>
              )}
              {documentError && (
                <div className="schedule-warnings document-warning document-error" role="alert">
                  <strong>Document upload could not be completed</strong>
                  <p>{documentError}</p>
                </div>
              )}
            </section>
          <div className="destinations">
            <h2>Destinations</h2>
            {trip.destinations.map((d, i) => (
              <div className="destination" key={i}>
                <input
                  value={d.country}
                  onChange={(e) => setDestination(i, "country", e.target.value)}
                  placeholder="Country"
                  className={fieldInvalid.destination(i).country ? "invalid" : ""}
                  aria-invalid={fieldInvalid.destination(i).country}
                />
                <input
                  value={d.city}
                  onChange={(e) => setDestination(i, "city", e.target.value)}
                  placeholder="City"
                  className={fieldInvalid.destination(i).city ? "invalid" : ""}
                  aria-invalid={fieldInvalid.destination(i).city}
                />
                {trip.destinations.length > 1 && (
                  <button
                    onClick={() =>
                      update(
                        "destinations",
                        trip.destinations.filter((_, n) => n !== i),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button className="add" onClick={appendDestination}>
              + Add destination
            </button>
          </div>
          <div className="itinerary">
            <div className="inline-heading">
              <h2>Day-by-day plan</h2>
              <div className="plan-actions">
                {isReconciling && (
                  <span className="reconciling">Updating plan…</span>
                )}
                <button className="add" onClick={() => addItem()}>
                  + Add activity
                </button>
              </div>
            </div>
            {scheduleWarnings.length > 0 && (
              <div className="schedule-warnings" role="alert">
                <strong>Planning issues could not be resolved</strong>
                <ul>
                  {scheduleWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {trip.itinerary.length === 0 && (
              <p className="empty">
                Add places, transport and meals to create your itinerary.
              </p>
            )}
            {itineraryDays.map(([dayNumber, activities]) => (
              <section className="day-plan" key={dayNumber}>
                <div className="day-plan-header">
                  <h3>
                    Day {dayNumber}
                    {dayDateLabel(dayNumber) && (
                      <span className="day-date"> — {dayDateLabel(dayNumber)}</span>
                    )}
                  </h3>
                  <div className="day-actions">
                    <button
                      className="day-add"
                      onClick={() => addItem(dayNumber)}
                      title={`Add an activity to Day ${dayNumber}`}
                    >
                      + Add activity
                    </button>
                    <button
                      className="day-toggle"
                      onClick={() => toggleDay(dayNumber)}
                      aria-expanded={!collapsedDays.has(dayNumber)}
                      aria-label={`${collapsedDays.has(dayNumber) ? "Expand" : "Collapse"} Day ${dayNumber}`}
                      title={`${collapsedDays.has(dayNumber) ? "Expand" : "Collapse"} Day ${dayNumber}`}
                    >
                      <span aria-hidden="true">
                        {collapsedDays.has(dayNumber) ? "⌄" : "⌃"}
                      </span>
                    </button>
                  </div>
                </div>
                {!collapsedDays.has(dayNumber) && (
                  <>
                    <div className="itinerary-columns" aria-hidden="true">
                      <span>Activity</span>
                      <span>Start</span>
                      <span>End</span>
                      <span>Minutes</span>
                      <span>Approx. fare</span>
                      <span />
                    </div>
                    {activities.map((item) => {
                      return (
                      <div
                        className={`item activity-${item.kind} ${dropTarget === item.index ? "drag-target" : ""}`}
                        key={item.index}
                        onDragOver={(event) => {
                          const sourceIndex =
                            draggedItemRef.current ?? draggedItem;
                          const source =
                            sourceIndex === null
                              ? undefined
                              : trip.itinerary[sourceIndex];
                          if (
                            !isReconciling &&
                            source &&
                            sourceIndex !== item.index
                          ) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setDropTarget(item.index);
                          }
                        }}
                        onDragLeave={() => setDropTarget(null)}
                        onDrop={(event) => {
                          event.preventDefault();
                          const transferValue =
                            event.dataTransfer.getData("text/plain");
                          const transferredIndex = transferValue
                            ? Number(transferValue)
                            : Number.NaN;
                          const sourceIndex = Number.isInteger(transferredIndex)
                            ? transferredIndex
                            : (draggedItemRef.current ?? draggedItem);
                          const source =
                            sourceIndex === null
                              ? undefined
                              : trip.itinerary[sourceIndex];
                          if (
                            source &&
                            sourceIndex !== null &&
                            sourceIndex !== item.index
                          )
                            moveItem(sourceIndex, item.index, item.day_number);
                          draggedItemRef.current = null;
                          setDraggedItem(null);
                          setDropTarget(null);
                        }}
                      >
                        <div className="activity-details">
                          <textarea
                            value={item.title}
                            onChange={(e) =>
                              setItem(item.index, "title", e.target.value)
                            }
                            placeholder="Activity"
                            aria-label="Activity name"
                            rows={2}
                          />
                          {item.kind === "transport" && item.notes && (
                            <p className="transport-route">
                              <strong>Route:</strong> {item.notes}
                            </p>
                          )}
                        </div>
                        <input
                          type="time"
                          value={item.start_time || ""}
                          onChange={(e) =>
                            setItem(item.index, "start_time", e.target.value)
                          }
                          aria-label="Start time"
                        />
                        <input
                          type="time"
                          value={item.end_time || ""}
                          onChange={(e) =>
                            setItem(item.index, "end_time", e.target.value)
                          }
                          aria-label="End time"
                        />
                        <input
                          type="number"
                          min="0"
                          value={item.duration_minutes ?? ""}
                          onChange={(e) =>
                            setItem(
                              item.index,
                              "duration_minutes",
                              +e.target.value,
                            )
                          }
                          placeholder="Minutes"
                          aria-label="Duration in minutes"
                        />
                        <input
                          type="number"
                          min="0"
                          value={item.estimated_cost ?? ""}
                          onChange={(e) =>
                            setItem(
                              item.index,
                              "estimated_cost",
                              +e.target.value,
                            )
                          }
                          placeholder="$"
                          aria-label="Estimated cost"
                        />
                        <div
                          className="item-actions"
                          aria-label="Reorder activity"
                        >
                          <button
                            className="drag-handle"
                            draggable={!isReconciling}
                            disabled={isReconciling}
                            aria-label={`Drag ${item.title} to reorder`}
                            title="Drag to reorder"
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "text/plain",
                                String(item.index),
                              );
                              draggedItemRef.current = item.index;
                              setDraggedItem(item.index);
                            }}
                            onDragEnd={() => {
                              draggedItemRef.current = null;
                              setDraggedItem(null);
                              setDropTarget(null);
                            }}
                          >
                            ⠿
                          </button>
                          <button
                            className="remove"
                            aria-label={`Remove ${item.title}`}
                            title="Remove activity"
                            onClick={() =>
                              update(
                                "itinerary",
                                trip.itinerary.filter(
                                  (_, index) => index !== item.index,
                                ),
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </>
                )}
              </section>
            ))}
          </div>
        </section>
        {chatMode === "open" && (
          <div
            className="assistant-resize-handle"
            onMouseDown={startAssistantResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the concierge panel"
          />
        )}
        <aside className="assistant" ref={assistantRef}>
          <div className="assistant-head">
            <div>
              <p className="eyebrow">TRAVEL CONCIERGE</p>
              <h2>Plan alongside your itinerary</h2>
            </div>
            <div className="chat-controls">
              {chatMode === "closed" ? (
                <button
                  className="icon-button"
                  title="Slide chat left into view"
                  aria-label="Slide chat left into view"
                  onClick={() => setChatMode("open")}
                >
                  ‹
                </button>
              ) : (
                <button
                  className="icon-button"
                  title="Slide chat right"
                  aria-label="Slide chat right"
                  onClick={() => setChatMode("closed")}
                >
                  ›
                </button>
              )}
            </div>
          </div>
          <div className="assistant-content">
            <p>
              Ask about routes, places, food, passes, or how to structure a day.
            </p>
            <div className="messages">
              {messages.length === 0 ? (
                <p className="empty">
                  {canGenerateRandomPlan
                    ? "Save this trip, then start a conversation. Your messages stay private to your account."
                    : "Describe your trip here — destination, dates, travelers — and I'll fill in the details for you."}
                </p>
              ) : (
                messages.map((m) => (
                  <div className={`message ${m.role}`} key={m.id}>
                    {m.content}
                  </div>
                ))
              )}
            </div>
            <form className="chat" onSubmit={chatSubmit}>
              <div className="chat-input">
                <textarea
                  value={chat}
                  onChange={(e) => setChat(e.target.value)}
                  placeholder={
                    !canGenerateRandomPlan
                      ? "Describe your trip — destination, dates, travelers…"
                      : "id" in trip
                        ? "Ask about this trip…"
                        : "Save the trip or generate a plan, then ask away…"
                  }
                  disabled={isGenerating}
                />
                <label
                  className="chat-attach"
                  title="Attach a travel document"
                  aria-disabled={isGenerating}
                >
                  📎
                  <input type="file" onChange={upload} disabled={isGenerating} />
                </label>
              </div>
              <button className="primary" disabled={isGenerating}>
                Send
              </button>
            </form>
          </div>
        </aside>
      </div>
    </main>
  );
}
export default App;
