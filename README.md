# Cobranza IA

Agente de voz que llama a clientes con cartera vencida, negocia un acuerdo de pago dentro de los límites que define la financiera y registra el resultado en un dashboard.

Proyecto para **Hacktoberfest @ México Tech Week 2026** (track *Best Use of ElevenLabs*).

## Cómo funciona

1. El dashboard muestra la cartera vencida (saldo, días de atraso, descuento máximo y parcialidades permitidas).
2. Al presionar **Llamar**, un Cloudflare Worker inicia una llamada saliente con **ElevenLabs Agents** por un número de **Twilio**, pasando los datos del cliente como variables dinámicas.
3. El agente (voz en español latino) confirma identidad, explica el adeudo, escucha el motivo y busca un compromiso: pago total con descuento, parcialidades o fecha compromiso.
4. Al colgar, ElevenLabs analiza la llamada y extrae: promesa de pago, monto, fecha, tipo de acuerdo, motivo de atraso y si pidió no ser llamado. También evalúa si la cobranza fue respetuosa.
5. El dashboard muestra el estatus en vivo, los indicadores y la transcripción.

## Cobranza respetuosa por diseño

- Bloquea llamadas fuera de 7:00–22:00 (hora de CDMX).
- El agente se identifica como asistente virtual.
- No habla de la deuda con terceros ni deja mensajes en buzón de voz.
- Nunca ofrece descuentos o plazos fuera de los autorizados.
- Respeta cuando el cliente pide no ser llamado o hablar con una persona.
- Cada llamada se audita automáticamente con un criterio de evaluación.

## Stack

- **ElevenLabs Agents**: voz, conversación, análisis y evaluación de llamadas.
- **Twilio**: telefonía saliente.
- **Cloudflare Workers**: dashboard y API (`src/index.js`, `src/page.html`).

## Desplegar

```bash
npx wrangler deploy
npx wrangler secret put ELEVENLABS_API_KEY   # API key de ElevenLabs
npx wrangler secret put AGENT_ID             # ID del agente en ElevenLabs
npx wrangler secret put PHONE_NUMBER_ID      # ID del número de Twilio importado en ElevenLabs
npx wrangler secret put DEMO_CODE            # código de acceso al dashboard
```

El agente en ElevenLabs usa las variables dinámicas `empresa`, `nombre`, `monto`, `dias_vencido`, `descuento_max` y `max_parcialidades`, los campos de *data collection* `promesa_pago`, `monto_acordado`, `fecha_pago`, `tipo_acuerdo`, `motivo_atraso` y `pidio_no_llamar`, y el criterio de evaluación `cobranza_respetuosa`.

## Equipo

Jesús Acevedo y Juvenal.
