import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = [
  "https://tesseractescoladesign.com.br",
  "https://tesseract-escola-de-design-com-outros-cursos-conf-822096532793.us-west1.run.app",
  "https://modal-meu-primeiro-app-67.vercel.app",
  "https://97-modal-meu-primeiro-app.vercel.app",
  "https://robsoliveiradesign.com.br",
  "https://checkout-meu-primeiro-app-97.vercel.app",
  "https://checkout-organico-meu-primeiro-app.vercel.app",
  "https://checkout-modal-antigravity.vercel.app",
  "https://checkout-mestre-aplicativos-ia.vercel.app",
  "https://checkout-upgrade-mestre-aplicativos.vercel.app",
  "https://comunidade-fogueteiros.vercel.app",
];

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.some((o) => origin.startsWith(o))
    ? origin
    : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-meli-session-id",
  "Content-Type": "application/json",
});

function gerarUsername(email) {
  const base = (email || "").split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20).padEnd(3, "x");
  return `${base}_${Date.now()}`.slice(0, 30);
}

async function enviarEmailPendente(email, nome, payment, RESEND_API_KEY) {
  const isPix = payment.payment_method_id === "pix";
  const subject = isPix ? "⏳ PIX gerado — aguardando pagamento" : "⏳ Boleto gerado — aguardando compensação";
  const instrucao = isPix
    ? "Seu QR Code PIX foi gerado. Assim que o pagamento for confirmado, você receberá o acesso."
    : "Seu boleto foi gerado. Após a compensação (1-3 dias úteis), você receberá o acesso por email.";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Tesseract Escola <naoresponda@tesseractescoladesign.com.br>",
        to: email,
        subject,
        html: `<div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
          <h2>Olá, ${nome}!</h2>
          <p>${instrucao}</p>
          <p style="font-size: 0.9em; color: #666;">Guarde este email — assim que confirmarmos seu pagamento, enviaremos o link de acesso.</p>
        </div>`,
      }),
    });
  } catch (e) {
    console.error("⚠️ Email pendente falhou:", e?.message);
  }
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || null;
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(405).json({ error: "Method not allowed" });
  }

  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "Variáveis de ambiente faltando (MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)",
      });
    }

    const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = req.body || {};
    const { curso_id, external_reference, item, telefone, payer, token, payment_method_id, issuer_id, installments, bump_curso_ids } = body;
    const cursoIdFinal = item?.id || curso_id;

    if (!cursoIdFinal) {
      return res.status(400).json({ error: "curso_id é obrigatório" });
    }

    const { data: produto, error: errProd } = await supabaseAdmin
      .from("produtos")
      .select("preco, nome, installments, statement_descriptor, course_id")
      .eq("id", cursoIdFinal)
      .single();

    if (errProd || !produto) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    const idempotencyKey =
      external_reference && external_reference !== "direto"
        ? `${external_reference}-${cursoIdFinal}`
        : `${payer?.email || "anon"}-${cursoIdFinal}-${Date.now()}`;

    let precoTotal = Number(produto.preco);
    const bumpsValidos = [];
    if (Array.isArray(bump_curso_ids) && bump_curso_ids.length > 0) {
      const { data: bumpsData } = await supabaseAdmin
        .from("produtos")
        .select("id, preco")
        .in("id", bump_curso_ids);
      if (bumpsData) {
        for (const bump of bumpsData) {
          precoTotal += Number(bump.preco);
          bumpsValidos.push(bump.id);
        }
      }
    }

    const nomeCompleto = (payer?.first_name || "").trim();
    const nameParts = nomeCompleto.split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || firstName;

    const telefoneRaw = (telefone || "").toString().replace(/\D/g, "");
    const cpfRaw = (payer?.identification?.number || "").replace(/\D/g, "");

    const payerFormatado = {
      email: payer?.email,
      first_name: firstName,
      last_name: lastName,
    };
    if (cpfRaw.length === 11) {
      payerFormatado.identification = { type: "CPF", number: cpfRaw };
    }
    if (telefoneRaw.length >= 10) {
      payerFormatado.phone = {
        area_code: telefoneRaw.slice(0, 2),
        number: telefoneRaw.slice(2),
      };
    }
    if (payerFormatado.email) {
      const addr = {};
      if (body.address_zip_code) addr.zip_code = String(body.address_zip_code).replace(/\D/g, "");
      if (body.address_street) addr.street_name = body.address_street;
      if (body.address_number) addr.street_number = String(body.address_number);
      if (body.address_city) addr.city = body.address_city;
      if (body.address_state) addr.state = String(body.address_state).toUpperCase().slice(0, 2);
      if (body.address_zip_code || body.address_street) payerFormatado.address = addr;
    }

    const mpPayload = {
      transaction_amount: precoTotal,
      description: produto.nome,
      payment_method_id,
      payer: payerFormatado,
      statement_descriptor: produto.statement_descriptor,
      notification_url: `${SUPABASE_URL}/functions/v1/mp-processar-pagamento`,
      external_reference: external_reference || "direto",
      metadata: {
        curso_id: cursoIdFinal,
        bump_curso_ids: bumpsValidos.join(","),
        source: "vercel_function_v1",
      },
    };

    if (token) {
      mpPayload.token = token;
      mpPayload.installments = Math.min(Number(installments) || 1, produto.installments || 3);
      if (issuer_id) mpPayload.issuer_id = String(issuer_id);
    }

    const xff = req.headers?.["x-forwarded-for"];
    const clientIp = xff?.split(",")[0]?.trim() || req.headers?.["x-real-ip"] || undefined;
    const meliSessionId = req.headers?.["x-meli-session-id"] || "";

    const additionalInfo = {};
    if (clientIp) additionalInfo.ip_address = clientIp;
    if (meliSessionId) additionalInfo.device_id = meliSessionId;
    additionalInfo.payer = {
      is_prime_user: false,
      is_first_purchase_online: !payerFormatado.email,
    };
    if (Object.keys(additionalInfo).length > 0) mpPayload.additional_info = additionalInfo;

    let leadId = null;
    try {
      const { data: rows, error: errLead } = await supabaseAdmin
        .from("leads")
        .insert({
          nome: payer?.first_name || "Lead Iniciado",
          email: payer?.email || "pendente@tesseract.com",
          telefone: telefone || null,
          curso_id: cursoIdFinal,
          bump_ids: bumpsValidos,
          status_pagamento: "pendente",
          criado_em: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (!errLead && rows?.id) leadId = rows.id;
      if (leadId) {
        mpPayload.external_reference = leadId;
        mpPayload.metadata.lead_id = leadId;
      }
    } catch (e) {
      console.error("⚠️ lead insert falhou:", e?.message);
    }

    const paymentClient = new Payment(mpClient);
    const payment = await paymentClient.create({
      body: mpPayload,
      requestOptions: { idempotencyKey },
    });

    if (leadId) {
      try {
        await supabaseAdmin
          .from("leads")
          .update({ status_pagamento: "pendente" })
          .eq("id", leadId);
      } catch (_) {}
    }

    const isPix = payment.payment_method_id === "pix";
    try {
      await supabaseAdmin.from("pagamentos").insert({
        email: (payer?.email || "").toLowerCase() || "pendente@tesseract.com",
        valor: Number(payment.transaction_amount) || precoTotal,
        status: payment.status,
        cobranca_id: String(payment.id),
        course_id: produto.course_id,
        evento_origem: "checkout_transparente_vf",
        cliente_id: payment.payer?.id ? String(payment.payer.id) : null,
        telefone: telefone || null,
        metadata: payment.status_detail ? { status_detail: payment.status_detail } : null,
        cpf: !isPix && cpfRaw.length === 11 ? cpfRaw : undefined,
      });
    } catch (e) {
      console.error("⚠️ pagamento insert falhou:", e?.message);
    }

    if (!payerFormatado.email) {
      const { data: profileExistente } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", payer?.email || "")
        .maybeSingle();
      if (!profileExistente && payer?.email) {
        try {
          await supabaseAdmin.from("profiles").insert({
            email: payer.email,
            name: firstName || payer.email.split("@")[0],
            username: gerarUsername(payer.email),
            role: "STUDENT",
            acesso_liberado: false,
            subscription_status: "inactive",
            meus_cursos: [],
            external_id: produto.course_id,
            cliente_id: payment.payer?.id ? String(payment.payer.id) : null,
            ultimo_pagamento_id: String(payment.id),
            valor_pago: Number(payment.transaction_amount) || precoTotal,
            updated_at: new Date().toISOString(),
          });
        } catch (e) {
          console.error("⚠️ profile insert falhou:", e?.message);
        }
      }
    }

    const nomeCliente = firstName || (payer?.email || "").split("@")[0];
    if (payment.status === "pending" && RESEND_API_KEY) {
      await enviarEmailPendente(payer?.email || "", nomeCliente, payment, RESEND_API_KEY);
    }

    const responseData = {
      status: payment.status,
      payment_id: payment.id,
      lead_id: leadId,
    };
    if (payment.payment_method_id === "pix") {
      responseData.payment_method_id = "pix";
      responseData.point_of_interaction = payment.point_of_interaction;
    }
    if (payment.payment_method_id === "bolbradesco" || payment.payment_method_id === "ticket") {
      responseData.ticket_url =
        payment.transaction_details?.external_resource_url || payment.transaction_details?.ticket_url;
    }

    return res.status(200).json(responseData);
  } catch (e) {
    console.error("❌ mp-process-payment erro:", e?.message || e);
    return res.status(500).json({ error: e?.message || "Erro interno" });
  }
}
