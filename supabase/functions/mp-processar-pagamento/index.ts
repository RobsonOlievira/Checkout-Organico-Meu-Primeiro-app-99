import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  "https://comunidade-fogueteiros.vercel.app"
];

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.some(o => origin.startsWith(o))
    ? origin
    : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-meli-session-id",
});

const FB_PIXEL_ID = Deno.env.get('FB_PIXEL_ID');
const FB_ACCESS_TOKEN = Deno.env.get('FB_ACCESS_TOKEN');

async function validarAssinaturaMP(req: Request, body: any, urlObj: URL): Promise<boolean> {
  const secret = Deno.env.get("MP_WEBHOOK_SECRET");
  if (!secret) return true;

  const topic = urlObj.searchParams.get("topic");
  const type = urlObj.searchParams.get("type");
  if (
    topic === "payment" || topic === "merchant_order" ||
    type === "payment" || type === "merchant_order"
  ) return true;

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  const dataId = urlObj.searchParams.get("data.id") ?? body?.data?.id ?? "";

  if (!xSignature || !xRequestId) return false;

  const parts = Object.fromEntries(xSignature.split(",").map(p => p.split("=")));
  const ts = parts["ts"];
  const v1 = parts["v1"];

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const hash = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  return hash === v1;
}

async function hashEmail(email: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function gerarUsername(email: string): string {
  const base = email.split("@")[0]
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 20)
    .padEnd(3, "x");
  return `${base}_${Date.now()}`.slice(0, 30);
}

async function resolverEmail(
  paymentData: any,
  paymentId: string,
  MP_ACCESS_TOKEN: string
): Promise<string> {
  let email: string | null = null;

  email = paymentData.metadata?.customer_email || null;
  if (!email || !email.includes("@")) email = paymentData.additional_info?.payer?.email || null;
  if (!email || email.includes("guest") || !email.includes("@")) email = paymentData.payer?.email || null;

  if (!email || email.includes("guest") || email.includes("XXX") || !email.includes("@")) {
    const pixEmail = paymentData.point_of_interaction?.transaction_data?.payer?.email;
    if (pixEmail && !pixEmail.includes("guest") && pixEmail.includes("@")) email = pixEmail;
  }

  if (!email || !email.includes("@")) {
    const payerId = paymentData.payer?.id;
    if (payerId) {
      try {
        const res = await fetch(`https://api.mercadopago.com/v1/customers/${payerId}`, {
          headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.email && !data.email.includes("guest")) email = data.email;
        }
      } catch (_) {}
    }
  }

  if (!email || !email.includes("@")) email = `aluno_${paymentId}@tesseractescoladesign.com.br`;
  return email.trim().toLowerCase();
}

async function ativarProfile(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
  cursoId: string,
  paymentData: any,
  paymentId: string
) {
  const { data: profileAtual } = await supabaseAdmin
    .from("profiles")
    .select("id, meus_cursos, external_id")
    .eq("email", email)
    .maybeSingle();

  const cursoParaLiberar = profileAtual?.external_id || cursoId || "low_ticket_maia";
  const cursosAtuais = Array.isArray(profileAtual?.meus_cursos) ? profileAtual.meus_cursos : [];
  const novosCursos = [...new Set([...cursosAtuais, cursoParaLiberar])].filter(Boolean);

  if (profileAtual) {
    console.log("🔓 Ativando profile:", email);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        name: paymentData.payer?.first_name || email.split("@")[0],
        acesso_liberado: true,
        subscription_status: "active",
        meus_cursos: novosCursos,
        cliente_id: paymentData.payer?.id?.toString() || null,
        ultimo_pagamento_id: paymentId,
        valor_pago: Number(paymentData.transaction_amount) || 0,
        data_expiracao: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("email", email);
    if (error) throw new Error(`Erro ao ativar profile: ${error.message}`);
    console.log(`✅ Profile ativado | cursos: ${JSON.stringify(novosCursos)}`);
  } else {
    console.log("📝 Profile não encontrado, criando já ativo:", email);
    const { error } = await supabaseAdmin.from("profiles").insert({
      email,
      name: paymentData.payer?.first_name || email.split("@")[0],
      username: gerarUsername(email),
      role: "STUDENT",
      acesso_liberado: true,
      subscription_status: "active",
      meus_cursos: novosCursos,
      external_id: cursoParaLiberar,
      cliente_id: paymentData.payer?.id?.toString() || null,
      ultimo_pagamento_id: paymentId,
      valor_pago: Number(paymentData.transaction_amount) || 0,
      data_expiracao: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Erro ao criar profile ativo: ${error.message}`);
  }
}

async function enviarEmailPendente(email: string, nomeCliente: string, payment: any, RESEND_API_KEY: string) {
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
          <h2>Olá, ${nomeCliente}!</h2>
          <p>${instrucao}</p>
          <p style="font-size: 0.9em; color: #666;">Guarde este email — assim que confirmarmos seu pagamento, enviaremos o link de acesso.</p>
        </div>`,
      }),
    });
    console.log(`✅ Email pendente enviado para: ${email}`);
  } catch (e: any) {
    console.error("⚠️ Erro ao enviar email pendente:", e.message);
  }
}

async function enviarEmailAcesso(email: string, nomeCliente: string, RESEND_API_KEY: string) {
  const linkCadastro = "https://tesseractescoladesign.com.br/#/show";
  let enviado = false;
  let tentativas = 0;

  while (!enviado && tentativas < 3) {
    tentativas++;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Tesseract Escola <naoresponda@tesseractescoladesign.com.br>",
          to: email,
          subject: "🚀 Seu acesso ao Curso de aplicativos com IA chegou!",
          html: `<div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
            <h2>Olá, ${nomeCliente}!</h2>
            <p>Seu pagamento foi confirmado e seu acesso à <strong>Tesseract Escola de Design</strong> está liberado!</p>
            <p>Clique no botão abaixo para finalizar seu cadastro e definir sua senha:</p>
            <div style="margin: 30px 0;">
              <a href="${linkCadastro}" style="background-color: #000; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Finalizar meu Cadastro
              </a>
            </div>
            <p style="font-size: 0.9em; color: #666;">Se o botão não funcionar, copie e cole este link:<br><a href="${linkCadastro}">${linkCadastro}</a></p>
          </div>`,
        }),
      });
      if (res.ok) {
        enviado = true;
        console.log(`✅ Email de acesso enviado para: ${email} (tentativa ${tentativas})`);
      } else {
        console.error(`⚠️ Tentativa ${tentativas} falhou:`, await res.text());
      }
    } catch (e: any) {
      console.error(`⚠️ Tentativa ${tentativas} — exceção:`, e.message);
    }
  }

  if (!enviado) console.error(`❌ Email NÃO enviado após ${tentativas} tentativas para: ${email}`);
}

async function criarLead(
  supabaseAdmin: ReturnType<typeof createClient>,
  data: {
    nome?: string;
    email?: string;
    telefone?: string;
    curso_id: string;
    bump_ids?: string[];
  }
): Promise<string | null> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("leads")
      .insert({
        nome: data.nome || "Lead Iniciado",
        email: data.email || "pendente@tesseract.com",
        telefone: data.telefone || null,
        curso_id: data.curso_id,
        bump_ids: data.bump_ids || [],
        status_pagamento: "pendente",
        criado_em: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("⚠️ Falha ao criar lead (não-crítico):", error.message);
      return null;
    }
    return rows?.id ?? null;
  } catch (e: any) {
    console.error("⚠️ Exceção ao criar lead (não-crítico):", e?.message);
    return null;
  }
}

async function atualizarLead(
  supabaseAdmin: ReturnType<typeof createClient>,
  leadId: string | null | undefined,
  patch: Record<string, any>
) {
  if (!leadId) return;
  try {
    const { error } = await supabaseAdmin.from("leads").update(patch).eq("id", leadId);
    if (error) console.error("⚠️ Falha ao atualizar lead (não-crítico):", error.message);
  } catch (e: any) {
    console.error("⚠️ Exceção ao atualizar lead (não-crítico):", e?.message);
  }
}

// ═════════════════════════════════════════════════════════════════
// ROTA 1: /criar-preferencia
// ═════════════════════════════════════════════════════════════════
async function handleCriarPreferencia(
  req: Request,
  supabaseAdmin: any,
  cors: Record<string, string>
): Promise<Response> {
  const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");
  const { curso_id, bump_ids, external_reference, payer, telefone } = await req.json();

  const leadId = await criarLead(supabaseAdmin, {
    nome: payer?.first_name,
    email: payer?.email,
    telefone,
    curso_id,
    bump_ids: Array.isArray(bump_ids) ? bump_ids : [],
  });

  const { data: produto, error: errProd } = await supabaseAdmin
    .from('produtos')
    .select('*')
    .eq('id', curso_id)
    .single();

  if (errProd || !produto) {
    console.error("Erro ao buscar produto:", errProd);
    return new Response(JSON.stringify({ error: "Curso não encontrado no sistema." }), {
      headers: { ...cors, "Content-Type": "application/json" }, status: 404
    });
  }

  const items = [{
    id: produto.id,
    title: produto.nome,
    quantity: 1,
    unit_price: Number(produto.preco),
    currency_id: "BRL",
    category_id: "digital_products",
    description: produto.nome,
  }];

  const bumpsValidos: string[] = [];
  if (bump_ids && Array.isArray(bump_ids) && bump_ids.length > 0) {
    const { data: bumps } = await supabaseAdmin
      .from('produtos')
      .select('id, nome, preco')
      .in('id', bump_ids);

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

  // 🔎 Puxa dados do lead existente para preencher payer (front só envia external_reference)
  let payerLead: { nome?: string | null; email?: string | null; telefone?: string | null } | null = null;
  if (leadId) {
    const { data: ld } = await supabaseAdmin
      .from("leads")
      .select("nome, email, telefone")
      .eq("id", leadId)
      .maybeSingle();
    payerLead = ld || null;
  }

  const payerEmail = payer?.email || payerLead?.email || null;
  const payerNome = (payer?.first_name || payerLead?.nome || "").trim();
  const payerTelefone = (payer?.phone?.area_code || telefone || payerLead?.telefone || "").toString().replace(/\D/g, "");

  const payerPref: Record<string, any> = {};
  if (payerEmail && payerEmail.includes("@")) payerPref.email = payerEmail;
  if (payerNome) {
    const parts = payerNome.split(/\s+/);
    payerPref.name = parts[0] || "";
    payerPref.surname = parts.slice(1).join(" ") || parts[0] || "";
  }
  if (payerTelefone.length >= 10) {
    payerPref.phone = {
      area_code: payerTelefone.slice(0, 2),
      number: payerTelefone.slice(2),
    };
  }
  // address com defaults (igual ao boleto) — pontua na avaliação do MP
  payerPref.address = {
    zip_code: "01001000",
    street_name: "Rua Example",
    street_number: "S/N",
    neighborhood: "Centro",
    city: "Sao Paulo",
    federal_unit: "SP",
  };

  // ⏰ expires — preferência válida por 7 dias
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items,
      payment_methods: { excluded_payment_types: [], max_installments: produto.installments || 3 },
      statement_descriptor: produto.statement_descriptor || "TESSERACT",
      external_reference: externalRef,
      auto_return: "approved",
      back_urls: {
        success: produto.success_url,
        failure: produto.failure_url,
        pending: produto.failure_url,
      },
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-processar-pagamento`,
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: expires.toISOString(),
      binary_mode: false,
      payer: payerPref,
      metadata: {
        curso_id,
        bump_curso_ids: bumpsValidos.join(","),
        lead_id: leadId || "",
      },
    }),
  });

  if (!mpRes.ok) throw new Error(`Erro MP: ${await mpRes.text()}`);
  const mpData = await mpRes.json();
  console.log(`✅ Preferência [${produto.id}] criada para: ${externalRef}`);

  if (leadId && mpData?.id) {
    await atualizarLead(supabaseAdmin, leadId, { mp_preference_id: mpData.id });
  }

  return new Response(
    JSON.stringify({ preference_id: mpData.id, init_point: mpData.init_point, lead_id: leadId }),
    { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
  );
}

// ═════════════════════════════════════════════════════════════════
// ROTA 2: /processar-pagamento
// ═════════════════════════════════════════════════════════════════
async function handleProcessarPagamento(
  req: Request,
  supabaseAdmin: ReturnType<typeof createClient>,
  cors: Record<string, string>
): Promise<Response> {
  const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN")!;
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
  const body = await req.json();
  const { curso_id, external_reference, item, ...formData } = body;
  const cursoIdFinal = item?.id || curso_id;

  console.log("📧 Payer recebido:", JSON.stringify(formData.payer));
  console.log("📦 Body completo:", JSON.stringify(body));

  const { data: produto, error: errProd } = await supabaseAdmin
    .from('produtos')
    .select('preco, nome, installments, statement_descriptor, course_id')
    .eq('id', cursoIdFinal)
    .single();

  if (errProd || !produto) {
    console.error("❌ Produto não encontrado:", cursoIdFinal);
    return new Response(JSON.stringify({ error: "Produto inválido" }), { status: 404, headers: cors });
  }

  console.log("💳 Processando pagamento para curso:", cursoIdFinal);
  console.log("📧 Email do formulário:", formData.payer?.email);

  const idempotencyKey = external_reference && external_reference !== "direto"
    ? `${external_reference}-${curso_id}`
    : `${formData.payer?.email}-${curso_id}-${Date.now()}`;

  const {
    token, payment_method_id, issuer_id, installments,
    transaction_amount, statement_descriptor, notification_url, payer,
    bump_curso_ids,
  } = formData as any;

  let precoTotal = Number(produto.preco);
  const bumpsValidos: string[] = [];
  if (bump_curso_ids && Array.isArray(bump_curso_ids) && bump_curso_ids.length > 0) {
    const { data: bumpsData, error: errBumps } = await supabaseAdmin
      .from('produtos')
      .select('id, preco')
      .in('id', bump_curso_ids);
    if (bumpsData && !errBumps) {
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

  const telefoneRaw = (formData.telefone ?? "").replace(/\D/g, "");
  const cpfRaw = (payer?.identification?.number || "").replace(/\D/g, "");

  const payerFormatado: Record<string, any> = {
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

  const leadId = await criarLead(supabaseAdmin, {
    nome: payer?.first_name,
    email: payer?.email,
    telefone: formData.telefone,
    curso_id: cursoIdFinal,
    bump_ids: bumpsValidos,
  });
  const externalRef = leadId || external_reference || "direto";

  const mpPayload: Record<string, any> = {
    transaction_amount: precoTotal,
    description: produto.nome,
    payment_method_id,
    payer: payerFormatado,
    statement_descriptor: produto.statement_descriptor,
    notification_url,
    external_reference: externalRef,
    metadata: {
      curso_id: cursoIdFinal,
      bump_curso_ids: bumpsValidos.join(","),
      lead_id: leadId || "",
    },
  };

  if (token) {
    mpPayload.token        = token;
    mpPayload.installments = Math.min(Number(installments) || 1, produto.installments || 3);
    if (issuer_id) mpPayload.issuer_id = String(issuer_id);
  }

  // payer.address — recomendado pela doc do MP ("todas as informações do payer")
  if (payerFormatado.email) {
    const addr: Record<string, any> = {};
    if (formData.address_zip_code)  addr.zip_code     = String(formData.address_zip_code).replace(/\D/g, "");
    if (formData.address_street)     addr.street_name  = formData.address_street;
    if (formData.address_number)    addr.street_number = String(formData.address_number);
    if (formData.address_city)      addr.city         = formData.address_city;
    if (formData.address_state)     addr.state        = String(formData.address_state).toUpperCase().slice(0, 2);
    if (formData.address_zip_code || formData.address_street) {
      payerFormatado.address = addr;
    }
  }

  // 🔐 Dados de antifraude (Device ID + additional_info.payer)
  const xff = req.headers.get("x-forwarded-for");
  const clientIp = xff?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || req.headers.get("cf-connecting-ip")
    || undefined;

  const meliSessionId = req.headers.get("x-meli-session-id") || "";
  const additionalInfo: Record<string, any> = {};

  if (clientIp) additionalInfo.ip_address = clientIp;
  if (meliSessionId) additionalInfo.device_id = meliSessionId;

  additionalInfo.payer = {
    is_prime_user: false,
    is_first_purchase_online: !payerFormatado.email,
  };

  if (Object.keys(additionalInfo).length > 0) {
    mpPayload.additional_info = additionalInfo;
  }

  const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(mpPayload),
  });

  if (!mpRes.ok) throw new Error(`Erro MP: ${await mpRes.text()}`);
  const payment = await mpRes.json();
  console.log("📦 Status MP:", payment.status);

  if (leadId) {
    await atualizarLead(supabaseAdmin, leadId, { status_pagamento: "pendente" });
  }

  let email: string | null = formData.payer?.email || null;

  if (external_reference && external_reference !== "direto") {
    const { data: lead } = await supabaseAdmin
      .from("leads").select("email, curso_id").eq("id", external_reference).maybeSingle();
    if (lead) {
      email = lead.email || email;
    }
  }

  if (!email || !email.includes("@")) email = payment.payer?.email || null;
  if (!email || !email.includes("@")) email = `aluno_${payment.id}@tesseractescoladesign.com.br`;
  email = email.trim().toLowerCase();
  console.log("📧 Email final:", email);

  const isPixPayment = payment.payment_method_id === "pix";
  const pagamentosInsert: Record<string, any> = {
    email,
    valor: Number(payment.transaction_amount) || 0,
    status: payment.status,
    cobranca_id: payment.id.toString(),
    course_id: produto.course_id,
    evento_origem: "checkout_transparente",
    cliente_id: payment.payer?.id?.toString() || null,
    telefone: formData.telefone || null,
    metadata: payment.status_detail ? { status_detail: payment.status_detail } : null,
  };
  if (!isPixPayment && cpfRaw.length === 11) {
    pagamentosInsert.cpf = cpfRaw;
  }
  const { error: errPag } = await supabaseAdmin.from("pagamentos").insert(pagamentosInsert);
  if (errPag) console.error("⚠️ Erro ao registrar pagamento:", errPag.message);

  const { data: profileAtual } = await supabaseAdmin
    .from("profiles").select("id").eq("email", email).maybeSingle();

  if (!profileAtual) {
    console.log("📝 Criando profile inativo:", email);
    const { error: errIns } = await supabaseAdmin.from("profiles").insert({
      email,
      name: formData.payer?.first_name || payment.payer?.first_name || email.split("@")[0],
      username: gerarUsername(email),
      role: "STUDENT",
      acesso_liberado: false,
      subscription_status: "inactive",
      meus_cursos: [],
      external_id: produto.course_id,
      cliente_id: payment.payer?.id?.toString() || null,
      ultimo_pagamento_id: payment.id.toString(),
      valor_pago: Number(payment.transaction_amount) || 0,
      updated_at: new Date().toISOString(),
    });
    if (errIns) console.error("❌ Erro ao criar profile:", errIns.message);
    else console.log("✅ Profile inativo criado:", email);
  } else {
    await supabaseAdmin.from("profiles").update({
      external_id: produto.course_id,
      cliente_id: payment.payer?.id?.toString() || null,
      ultimo_pagamento_id: payment.id.toString(),
      valor_pago: Number(payment.transaction_amount) || 0,
      updated_at: new Date().toISOString(),
    }).eq("email", email);
  }

  const nomeCliente = formData.payer?.first_name ?? payment.payer?.first_name ?? email.split("@")[0];
  if (payment.status === "pending") {
    await enviarEmailPendente(email, nomeCliente, payment, RESEND_API_KEY);
  } else if (payment.status === "approved") {
    await enviarEmailAcesso(email, nomeCliente, RESEND_API_KEY);
    await ativarProfile(supabaseAdmin, email, cursoIdFinal, payment, payment.id.toString());
    if (leadId) {
      await atualizarLead(supabaseAdmin, leadId, { status_pagamento: "pago" });
    }
  }

  const responseData: any = { status: payment.status, payment_id: payment.id, lead_id: leadId };

  if (payment.payment_method_id === "pix") {
    responseData.payment_method_id = "pix";
    responseData.point_of_interaction = payment.point_of_interaction;
  }

  if (payment.payment_method_id === "bolbradesco" || payment.payment_method_id === "ticket") {
    responseData.ticket_url = payment.transaction_details?.external_resource_url || payment.transaction_details?.ticket_url;
  }

  return new Response(
    JSON.stringify(responseData),
    { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
  );
}

async function handleWebhook(
  req: Request,
  supabaseAdmin: ReturnType<typeof createClient>,
  urlObj: URL,
  cors: Record<string, string>
): Promise<Response> {
  const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN")!;
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

  const body = await req.json();

  const valido = await validarAssinaturaMP(req, body, urlObj);
  if (!valido) {
    console.warn("⚠️ Assinatura inválida — webhook rejeitado");
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const topicParam = urlObj.searchParams.get("topic");
  const idParam = urlObj.searchParams.get("id");
  const dataIdParam = urlObj.searchParams.get("data.id");
  const typeParam = urlObj.searchParams.get("type");

  let mpPaymentId: string | null =
    (body.type === "payment" && body.data?.id) ? body.data.id :
    (body.action?.startsWith("payment") && body.data?.id) ? body.data.id :
    (topicParam === "payment" && idParam) ? idParam :
    (typeParam === "payment" && dataIdParam) ? dataIdParam :
    null;

  if (!mpPaymentId && topicParam === "merchant_order" && idParam) {
    const moRes = await fetch(`https://api.mercadopago.com/merchant_orders/${idParam}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (moRes.ok) {
      const moData = await moRes.json();
      const approvedPayment = moData.payments?.find((p: any) => p.status === "approved");
      mpPaymentId = approvedPayment?.id?.toString() ?? null;
      if (!mpPaymentId) {
        return new Response(JSON.stringify({ success: true, message: "merchant_order sem pagamento aprovado ainda" }), { status: 200 });
      }
    }
  }

  if (!mpPaymentId) {
    return new Response(JSON.stringify({ success: true, message: "Sem payment ID" }), { status: 200 });
  }

  const paymentId = mpPaymentId.toString();
  console.log("🔍 Webhook recebido para pagamento:", paymentId);

  const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });
  if (!mpResponse.ok) throw new Error(`Erro MP: ${mpResponse.status}`);
  const paymentData = await mpResponse.json();

  console.log("📦 Status MP:", paymentData.status);

  const { data: pagAtual } = await supabaseAdmin
    .from("pagamentos")
    .select("id, status, email, course_id")
    .eq("cobranca_id", paymentId)
    .maybeSingle();

  if (paymentData.status === "refunded" || paymentData.status === "cancelled") {
    console.log(`🔄 ${paymentData.status} recebido para pagamento: ${paymentId}`);

    await supabaseAdmin
      .from("pagamentos")
      .update({
        status: paymentData.status,
        atualizado_em: new Date().toISOString(),
      })
      .eq("cobranca_id", paymentId);

    const emailReembolso = pagAtual?.email ?? null;
    if (emailReembolso) {
      await supabaseAdmin
        .from("profiles")
        .update({
          acesso_liberado: false,
          subscription_status: "inactive",
          updated_at: new Date().toISOString(),
        })
        .eq("email", emailReembolso);

      console.log(`✅ Acesso revogado via webhook MP para: ${emailReembolso}`);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }

  if (paymentData.status !== "approved") {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }

  if (pagAtual?.status === "approved") {
    console.log("⚠️ Já processado como approved:", paymentId);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }

  const installmentNumber = paymentData.installments_sequence ?? paymentData.installment ?? null;
  if (installmentNumber != null && installmentNumber > 1) {
    console.log(`⏭️ Parcela ${installmentNumber} ignorada`);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }

  let email: string | null = pagAtual?.email ?? null;
  let cursoId: string = pagAtual?.course_id ?? "low_ticket_maia";

  if (!email || !email.includes("@")) {
    const leadId = paymentData.external_reference || null;
    if (leadId && leadId !== "direto") {
      const { data: lead } = await supabaseAdmin
        .from("leads").select("email, curso_id").eq("id", leadId).maybeSingle();
      if (lead) {
        email = lead.email || null;
        await atualizarLead(supabaseAdmin, leadId, { status_pagamento: "pago" });
      }
    }
  }

  if (!email || !email.includes("@")) {
    email = await resolverEmail(paymentData, paymentId, MP_ACCESS_TOKEN);
  }

  email = email.trim().toLowerCase();
  console.log("📧 Email final:", email);

  const cpfFromPayment = (paymentData.payer?.identification?.number || "").replace(/\D/g, "");
  const isPixPayment = paymentData.payment_method_id === "pix";
  const { error: upsertError } = await supabaseAdmin
    .from("pagamentos")
    .upsert(
      {
        cobranca_id: paymentId,
        email,
        valor: Number(paymentData.transaction_amount) || 0,
        status: "approved",
        course_id: cursoId,
        evento_origem: "PAYMENT_CONFIRMED",
        cliente_id: paymentData.payer?.id?.toString() || null,
        cpf: !isPixPayment && cpfFromPayment.length === 11 ? cpfFromPayment : undefined,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "cobranca_id", ignoreDuplicates: false }
    )
    .select("id, status")
    .maybeSingle();

  if (upsertError) {
    console.error("❌ Erro no upsert de pagamento:", upsertError.message);
    throw new Error(upsertError.message);
  }

  const processamento = async () => {
    await ativarProfile(supabaseAdmin, email!, cursoId, paymentData, paymentId);
    const nomeCliente = paymentData.payer?.first_name ?? email!.split("@")[0];
    await enviarEmailAcesso(email!, nomeCliente, RESEND_API_KEY);

    if (FB_PIXEL_ID && FB_ACCESS_TOKEN) {
      try {
        const hashedEmail = await hashEmail(email!);
        await fetch(`https://graph.facebook.com/v19.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: [{
              event_name: "Purchase",
              event_time: Math.floor(Date.now() / 1000),
              action_source: "website",
              user_data: { em: [hashedEmail] },
              custom_data: {
                value: Number(paymentData.transaction_amount),
                currency: "BRL",
                content_name: cursoId,
              },
            }],
          }),
        });
        console.log("✅ Meta CAPI Purchase disparado para:", email);
      } catch (e) {
        console.error("❌ Erro Meta CAPI:", e);
      }
    }
  };

  EdgeRuntime.waitUntil(processamento());

  return new Response(
    JSON.stringify({ success: true, message: "Acesso liberado" }),
    { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
  );
}

async function handleNovoUsuario(
  req: Request,
  supabaseAdmin: ReturnType<typeof createClient>,
  cors: Record<string, string>
): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Authorization header ausente." }), { status: 401 });
  }

  const { user_id, email, name } = await req.json();
  if (!user_id || !email) {
    return new Response(JSON.stringify({ error: "user_id e email são obrigatórios." }), { status: 400 });
  }

  const { data: { user: tokenUser }, error: tokenError } = await supabaseAdmin.auth.getUser(
    authHeader.replace("Bearer ", "")
  );
  if (tokenError || !tokenUser) {
    return new Response(JSON.stringify({ error: "Token inválido." }), { status: 401 });
  }
  if (tokenUser.id !== user_id) {
    return new Response(JSON.stringify({ error: "user_id não corresponde ao token." }), { status: 403 });
  }

  const emailFinal = email.toLowerCase().trim();
  console.log(`🆕 Novo usuário: ${emailFinal} | auth.uid: ${user_id}`);

  const { data: profileExistente } = await supabaseAdmin
    .from("profiles")
    .select("id, acesso_liberado, subscription_status, meus_cursos")
    .eq("email", emailFinal)
    .maybeSingle();

  if (profileExistente) {
    console.log(`🔗 Vinculando auth ${user_id} ao profile de ${emailFinal}`);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ id: user_id, updated_at: new Date().toISOString() })
      .eq("email", emailFinal);
    if (error) throw new Error(`Erro ao vincular auth: ${error.message}`);

    return new Response(
      JSON.stringify({
        success: true,
        acesso_liberado: profileExistente.acesso_liberado,
        subscription_status: profileExistente.subscription_status,
        meus_cursos: profileExistente.meus_cursos,
      }),
      { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
    );
  }

  console.log(`📝 Criando profile inativo para: ${emailFinal}`);
  const { error } = await supabaseAdmin.from("profiles").insert({
    id: user_id,
    email: emailFinal,
    name: name ?? emailFinal.split("@")[0],
    username: gerarUsername(emailFinal),
    role: "STUDENT",
    acesso_liberado: false,
    subscription_status: "inactive",
    meus_cursos: [],
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Insert profile falhou: ${error.message}`);

  return new Response(
    JSON.stringify({ success: true, acesso_liberado: false, subscription_status: "inactive" }),
    { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
  );
}

async function handleAdmin(
  req: Request,
  supabaseAdmin: ReturnType<typeof createClient>,
  cors: Record<string, string>
): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Header de autorização ausente." }), { status: 401 });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user: adminUser }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !adminUser) throw new Error("Não autorizado: Faça login novamente.");

  const { data: adminProfile } = await supabaseAdmin
    .from("profiles").select("role").eq("id", adminUser.id).single();
  if (adminProfile?.role !== "ADMIN") throw new Error("Acesso Negado: Apenas administradores.");

  const body = await req.json();

  if (body.userId) {
    const { userId, subscription_status, acesso_liberado, data_expiracao, meus_cursos, role } = body;
    const { data: profileAtual, error: fetchError } = await supabaseAdmin
      .from("profiles").select("id, meus_cursos").eq("id", userId).single();
    if (fetchError || !profileAtual) throw new Error(`Usuário não encontrado: ${userId}`);

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (subscription_status !== undefined) payload.subscription_status = subscription_status;
    if (acesso_liberado !== undefined) payload.acesso_liberado = acesso_liberado;
    if (role !== undefined) payload.role = role;

    if (data_expiracao !== undefined) {
      if (typeof data_expiracao === "number") {
        const d = new Date();
        d.setDate(d.getDate() + data_expiracao);
        payload.data_expiracao = d.toISOString();
      } else {
        payload.data_expiracao = data_expiracao;
      }
    }

    if (Array.isArray(meus_cursos)) {
      const cursosAtuais = Array.isArray(profileAtual.meus_cursos) ? profileAtual.meus_cursos : [];
      payload.meus_cursos = meus_cursos.length === 0
        ? []
        : [...new Set([...cursosAtuais, ...meus_cursos])];
    }

    await supabaseAdmin.from("profiles").update(payload).eq("id", userId);
    return new Response(
      JSON.stringify({ success: true, updated: payload }),
      { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
    );
  }

  const { email, password, name, role, customRole, cpf, phone, meus_cursos: manualCursos } = body;
  if (!email || !password) throw new Error("email e password são obrigatórios.");

  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name, username: email.split("@")[0] },
  });
  if (createError) throw createError;

  if (newUser.user) {
    await supabaseAdmin.from("profiles").update({
      name,
      username: gerarUsername(email),
      role: role || "STUDENT",
      custom_role: customRole ?? null,
      cpf: cpf ?? null,
      phone: phone ?? null,
      subscription_status: "active",
      acesso_liberado: true,
      meus_cursos: Array.isArray(manualCursos) ? manualCursos : [],
      data_expiracao: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", newUser.user.id);
  }

  return new Response(
    JSON.stringify({ success: true, user: newUser.user }),
    { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
  );
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const urlObj = new URL(req.url);
  const path = urlObj.pathname;
  console.log("Path recebido:", path);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const isWebhook =
    urlObj.searchParams.has("data.id") ||
    urlObj.searchParams.get("topic") === "payment" ||
    urlObj.searchParams.get("topic") === "merchant_order" ||
    urlObj.searchParams.get("type") === "payment";

  if (isWebhook || path.endsWith("/webhook")) {
    return await handleWebhook(req, supabaseAdmin, urlObj, cors);
  }

  let body: any = {};
  if (req.method === "POST") {
    try {
      body = await req.clone().json();
    } catch (_) {
      body = {};
    }
  }

  if (body?.tipo === "criar_preferencia") {
    return await handleCriarPreferencia(req, supabaseAdmin, cors);
  }

  if (body?.token || body?.payment_method_id) {
    return await handleProcessarPagamento(req, supabaseAdmin, cors);
  }

  if (path.endsWith("/novo-usuario")) {
    return await handleNovoUsuario(req, supabaseAdmin, cors);
  }

  if (path.endsWith("/admin")) {
    return await handleAdmin(req, supabaseAdmin, cors);
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
