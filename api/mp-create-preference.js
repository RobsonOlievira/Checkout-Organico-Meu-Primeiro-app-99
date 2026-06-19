import { MercadoPagoConfig, Preference } from "mercadopago";
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
});

function gerarUsername(email) {
  const base = (email || "").split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20).padEnd(3, "x");
  return `${base}_${Date.now()}`.slice(0, 30);
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

    if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "Variáveis de ambiente faltando (MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)",
      });
    }

    const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { curso_id, bump_ids, external_reference, payer, telefone } = req.body || {};

    if (!curso_id) {
      return res.status(400).json({ error: "curso_id é obrigatório" });
    }

    const { data: produto, error: errProd } = await supabaseAdmin
      .from("produtos")
      .select("*")
      .eq("id", curso_id)
      .single();

    if (errProd || !produto) {
      return res.status(404).json({ error: "Curso não encontrado." });
    }

    let leadId = null;
    try {
      const { data: rows, error: errLead } = await supabaseAdmin
        .from("leads")
        .insert({
          nome: payer?.first_name || "Lead Iniciado",
          email: payer?.email || "pendente@tesseract.com",
          telefone: telefone || null,
          curso_id,
          bump_ids: Array.isArray(bump_ids) ? bump_ids : [],
          status_pagamento: "pendente",
          criado_em: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (!errLead && rows?.id) leadId = rows.id;
    } catch (e) {
      console.error("⚠️ lead insert falhou (não-crítico):", e?.message);
    }

    const items = [
      {
        id: produto.id,
        title: produto.nome,
        quantity: 1,
        unit_price: Number(produto.preco),
        currency_id: "BRL",
        category_id: "digital_products",
        description: produto.nome,
      },
    ];
    const bumpsValidos = [];
    if (Array.isArray(bump_ids) && bump_ids.length > 0) {
      const { data: bumps } = await supabaseAdmin
        .from("produtos")
        .select("id, nome, preco")
        .in("id", bump_ids);
      if (bumps) {
        for (const b of bumps) {
          items.push({
            id: b.id,
            title: b.nome,
            quantity: 1,
            unit_price: Number(b.preco),
            currency_id: "BRL",
            category_id: "digital_products",
            description: b.nome,
          });
          bumpsValidos.push(b.id);
        }
      }
    }

    const externalRef = leadId || external_reference || "direto";

    const payerNome = (payer?.first_name || "").trim();
    const payerParts = payerNome ? payerNome.split(/\s+/) : [];
    const payerPhone = (telefone || "").toString().replace(/\D/g, "");
    const payerEmail = (payer?.email || "").trim();

    const preferenceClient = new Preference(mpClient);
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    const mpRes = await preferenceClient.create({
      body: {
        items,
        payer: {
          name: payerParts[0] || undefined,
          surname: payerParts.slice(1).join(" ") || undefined,
          email: payerEmail && payerEmail.includes("@") ? payerEmail : undefined,
          phone:
            payerPhone.length >= 10
              ? {
                  area_code: payerPhone.slice(0, 2),
                  number: payerPhone.slice(2),
                }
              : undefined,
          address: {
            zip_code: "01001000",
            street_name: "Rua Example",
            street_number: "S/N",
            neighborhood: "Centro",
            city: "Sao Paulo",
            federal_unit: "SP",
          },
        },
        payment_methods: {
          excluded_payment_types: [],
          max_installments: produto.installments || 3,
        },
        statement_descriptor: produto.statement_descriptor || "TESSERACT",
        external_reference: externalRef,
        notification_url: `${SUPABASE_URL}/functions/v1/mp-processar-pagamento`,
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: expires.toISOString(),
        binary_mode: false,
        auto_return: "approved",
        back_urls: {
          success: produto.success_url,
          failure: produto.failure_url,
          pending: produto.failure_url,
        },
        metadata: {
          curso_id,
          bump_curso_ids: bumpsValidos.join(","),
          lead_id: leadId || "",
          source: "vercel_function_v1",
        },
      },
    });

    if (leadId && mpRes?.id) {
      try {
        await supabaseAdmin
          .from("leads")
          .update({ mp_preference_id: String(mpRes.id) })
          .eq("id", leadId);
      } catch (e) {
        console.error("⚠️ Falha ao gravar mp_preference_id (não-crítico):", e?.message);
      }
    }

    return res.status(200).json({
      preference_id: mpRes.id,
      init_point: mpRes.init_point,
      lead_id: leadId,
    });
  } catch (e) {
    console.error("❌ mp-create-preference erro:", e?.message || e);
    return res.status(500).json({ error: e?.message || "Erro interno" });
  }
}
