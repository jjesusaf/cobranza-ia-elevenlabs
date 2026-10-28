import PAGE from "./page.html";

const API = "https://api.elevenlabs.io/v1/convai";
const HORA_INICIO = 7;
const HORA_FIN = 22;
const ESPERA_MISMO_NUMERO_MS = 60_000;
const CACHE_LISTA_MS = 3_000;

// La cartera vive en el servidor: la página solo manda id y teléfono.
const CARTERA = [
  { id: "c1", nombre: "Jesús Acevedo", monto: 4500, dias_vencido: 35, descuento_max: 15, max_parcialidades: 3 },
  { id: "c2", nombre: "Juvenal", monto: 5600, dias_vencido: 45, descuento_max: 15, max_parcialidades: 3 },
  { id: "c3", nombre: "María López", monto: 12800, dias_vencido: 62, descuento_max: 20, max_parcialidades: 6 },
  { id: "c4", nombre: "Carlos Hernández", monto: 2300, dias_vencido: 18, descuento_max: 10, max_parcialidades: 2 },
  { id: "c5", nombre: "Ana Martínez", monto: 7950, dias_vencido: 90, descuento_max: 25, max_parcialidades: 4 },
];

// Estado por isolate: suficiente para frenar dobles clics y saturar menos la API en la demo.
const ultimaLlamadaPorNumero = new Map();
let cacheLista = { hasta: 0, data: null };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (!url.pathname.startsWith("/api/")) return json({ error: "No encontrado" }, 404);

    if (!env.DEMO_CODE || !env.ELEVENLABS_API_KEY) {
      return json({ error: "Faltan secretos DEMO_CODE o ELEVENLABS_API_KEY" }, 500);
    }
    if (req.headers.get("x-demo-code") !== env.DEMO_CODE) {
      return json({ error: "Código de acceso inválido" }, 401);
    }

    try {
      if (url.pathname === "/api/horario") return json(horario());
      if (url.pathname === "/api/call" && req.method === "POST") return await iniciarLlamada(req, env);
      if (url.pathname === "/api/calls" && req.method === "GET") {
        return await listarLlamadas(env).catch((e) =>
          json({ horario: horario(), cartera: CARTERA, llamadas: [], error: String(e.message || e) }),
        );
      }
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
    return json({ error: "No encontrado" }, 404);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Hora local del deudor: la demo asume CDMX.
function horario() {
  const hora = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Mexico_City",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  return { hora, permitido: hora >= HORA_INICIO && hora < HORA_FIN, ventana: `${HORA_INICIO}:00–${HORA_FIN}:00` };
}

function normalizarTelefono(raw) {
  const digitos = String(raw || "").replace(/\D/g, "");
  if (digitos.length === 10) return `+52${digitos}`;
  if (digitos.length === 12 && digitos.startsWith("52")) return `+${digitos}`;
  if (digitos.length === 13 && digitos.startsWith("521")) return `+52${digitos.slice(3)}`;
  return null;
}

async function elevenlabs(env, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${JSON.stringify(body.detail || body).slice(0, 300)}`);
  return body;
}

async function iniciarLlamada(req, env) {
  const h = horario();
  if (!h.permitido) {
    return json({ error: `Fuera del horario permitido de cobranza (${h.ventana} CDMX). Son las ${h.hora}:00.` }, 403);
  }

  const body = await req.json().catch(() => null);
  const c = CARTERA.find((x) => x.id === body?.id);
  if (!c) return json({ error: "Cliente inválido" }, 400);
  const to = normalizarTelefono(body.telefono);
  if (!to) return json({ error: "Teléfono inválido: usa 10 dígitos de México" }, 400);

  const previa = ultimaLlamadaPorNumero.get(to) || 0;
  if (Date.now() - previa < ESPERA_MISMO_NUMERO_MS) {
    return json({ error: "Ya se llamó a ese número hace menos de un minuto" }, 429);
  }
  ultimaLlamadaPorNumero.set(to, Date.now());

  const r = await elevenlabs(env, "/twilio/outbound-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: env.AGENT_ID,
      agent_phone_number_id: env.PHONE_NUMBER_ID,
      to_number: to,
      conversation_initiation_client_data: {
        dynamic_variables: {
          empresa: env.EMPRESA,
          nombre: String(c.nombre),
          monto: String(c.monto),
          dias_vencido: String(c.dias_vencido),
          descuento_max: String(c.descuento_max),
          max_parcialidades: String(c.max_parcialidades),
          cliente_id: String(c.id),
        },
      },
    }),
  }).catch((e) => {
    ultimaLlamadaPorNumero.delete(to);
    throw e;
  });
  if (!r.success) {
    ultimaLlamadaPorNumero.delete(to);
    return json({ error: r.message || "No se pudo iniciar la llamada" }, 502);
  }
  cacheLista.hasta = 0;
  return json({ conversation_id: r.conversation_id });
}

async function listarLlamadas(env) {
  if (cacheLista.data && Date.now() < cacheLista.hasta) return json(cacheLista.data);
  const lista = await elevenlabs(env, `/conversations?agent_id=${env.AGENT_ID}&page_size=20`);
  const detalles = await Promise.all(
    (lista.conversations || []).map((c) => elevenlabs(env, `/conversations/${c.conversation_id}`).catch(() => null)),
  );

  const llamadas = detalles
    .filter((d) => d && d.metadata && d.metadata.phone_call)
    .map((d) => {
      const dv = d.conversation_initiation_client_data?.dynamic_variables || {};
      const a = d.analysis || {};
      const datos = {};
      for (const [k, v] of Object.entries(a.data_collection_results || {})) datos[k] = v?.value ?? null;
      const ev = a.evaluation_criteria_results?.cobranza_respetuosa;
      const tel = d.metadata.phone_call.external_number || "";
      return {
        id: d.conversation_id,
        status: d.status,
        inicio: d.metadata.start_time_unix_secs,
        duracion: d.metadata.call_duration_secs,
        resultado_llamada: d.metadata.phone_call.call_result || null,
        terminacion: d.metadata.termination_reason || "",
        error_llamada: d.metadata.error?.reason || null,
        cliente: dv.nombre || "—",
        cliente_id: dv.cliente_id || null,
        monto: dv.monto || null,
        telefono: tel ? `•••• ${tel.slice(-4)}` : "",
        datos,
        evaluacion: ev?.result || null,
        evaluacion_motivo: ev?.rationale || "",
        resumen: a.transcript_summary || "",
        transcripcion: (d.transcript || [])
          .filter((t) => t.message)
          .map((t) => ({ rol: t.role, texto: t.message })),
      };
    });

  const data = { horario: horario(), cartera: CARTERA, llamadas };
  cacheLista = { hasta: Date.now() + CACHE_LISTA_MS, data };
  return json(data);
}
