import React, { useState, useEffect } from "react";

const SUPABASE_URL = "https://bgpygirvzfjvfathywjb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncHlnaXJ2emZqdmZhdGh5d2piIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2NTUzMjYsImV4cCI6MjA4NTIzMTMyNn0.XhISEn_lCjb_ZejanwZDE98lBDDsCI4bwHZr6bdEKCA";
const MP_PUBLIC_KEY = "APP_USR-76ab7025-3464-4e2b-b5fd-793afa73a6f0";
const BUMP_IDS = ["antigravity", "ebook_como_vender_saas"];

function getUTMs() {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_content: params.get("utm_content") || "",
    utm_term: params.get("utm_term") || "",
  };
}

interface CheckoutModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  cursoId?: string;
  asPage?: boolean;
}

export function CheckoutModal({
  isOpen,
  onClose,
  cursoId = "low_ticket_maia_67",
  asPage = false,
}: CheckoutModalProps) {
  const [activeTab, setActiveTab] = useState<"pix" | "cartao" | "boleto">("pix");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error" | "pending">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [pixData, setPixData] = useState<{ qrCodeBase64: string, copyPaste: string } | null>(null);
  const [produto, setProduto] = useState<{ preco: number, installments: number, nome: string, success_url: string } | null>(null);
  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    telefone: "",
    numeroCartao: "",
    nomeCartao: "",
    validade: "",
    cvv: "",
    installment: "1",
  });

  const [leadId, setLeadId] = useState<string | null>(null);
  const [cpf, setCpf] = useState("");
  const [boletoCode, setBoletoCode] = useState("");
  const [selectedBumps, setSelectedBumps] = useState<string[]>([]);
  const [allBumps, setAllBumps] = useState<Array<{ id: string, preco: number, nome: string, imagem?: string, descricao?: string }>>([]);
  const [ultimoMetodo, setUltimoMetodo] = useState<string>("");
  const [attemptCount, setAttemptCount] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [loadingLink, setLoadingLink] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");

  function getStatusDetailMessage(detail: string): string {
    const messages: Record<string, string> = {
      cc_rejected_bad_filled_card_number: "Número do cartão inválido. Verifique e tente novamente.",
      cc_rejected_bad_filled_date: "Data de validade inválida. Verifique e tente novamente.",
      cc_rejected_bad_filled_other: "Dados do cartão incorretos. Verifique e tente novamente.",
      cc_rejected_bad_filled_security_code: "CVV inválido. Verifique e tente novamente.",
      cc_rejected_blacklist: "Cartão recusado pelo banco emissor. Tente outro cartão ou forma de pagamento.",
      cc_rejected_call_for_authorize: "Cartão necessita autorização. Entre em contato com seu banco.",
      cc_rejected_card_disabled: "Cartão desativado. Entre em contato com seu banco.",
      cc_rejected_card_high_risk: "Cartão recusado por motivo de segurança. Tente outro cartão.",
      cc_rejected_duplicate_payment: "Pagamento duplicado. Já existe uma cobrança similar em processamento.",
      cc_rejected_high_risk: "Pagamento recusado pelo antifraude. Não insista — tente outro cartão ou forma de pagamento.",
      cc_rejected_insufficient_amount: "Limite insuficiente no cartão. Tente outro cartão ou use PIX.",
      cc_rejected_invalid_installments: "Parcelamento inválido para este cartão. Escolha outra quantidade de parcelas.",
      cc_rejected_max_attempts: "Você excedeu o limite de tentativas. Tente novamente mais tarde.",
      cc_rejected_other_reason: "Cartão recusado pelo banco emissor. Tente outro cartão ou forma de pagamento.",
      cc_amount_rate_constraint: "Valor fora dos limites permitidos pelo banco. Tente outro cartão ou use PIX.",
      cc_rejected_expired_card: "Cartão vencido. Use outro cartão.",
      rejected_high_risk: "Pagamento recusado pelo sistema antifraude. Tente novamente com dados corretos.",
    };
    return messages[detail] || "Pagamento recusado. Verifique os dados e tente novamente.";
  }

  const valorBase = produto?.preco || 99;
  const valorBump = allBumps.filter(b => selectedBumps.includes(b.id)).reduce((sum, b) => sum + b.preco, 0);
  const valorTotal = valorBase + valorBump;

  async function criarLinkPagamento(leadUuid?: string | null) {
    setLoadingLink(true);
    let ref = leadUuid;
    if (!ref) {
      const utms = getUTMs();
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Prefer": "return=representation" },
          body: JSON.stringify({ nome: formData.nome || "Lead", email: formData.email || "pendente@tesseract.com", telefone: formData.telefone, curso_id: cursoId, bump_ids: selectedBumps, status_pagamento: "pendente", ...utms, criado_em: new Date().toISOString() }),
        });
        if (r.ok) { const d = await r.json(); ref = d?.[0]?.id || null; }
      } catch {}
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mp-processar-pagamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ tipo: "criar_preferencia", curso_id: cursoId, bump_ids: selectedBumps, external_reference: ref || "direto" }),
      });
      const data = await res.json();
      if (data.init_point) {
        setPaymentLink(data.init_point);
        window.open(data.init_point, "_blank");
      } else {
        setErrorMsg("Erro ao gerar link de pagamento. Tente novamente.");
      }
    } catch {
      setErrorMsg("Erro ao gerar link de pagamento. Tente novamente.");
    } finally {
      setLoadingLink(false);
    }
  }

  function tentarNovamente() {
    setStatus("idle");
    setErrorMsg("");
    setPixData(null);
    setBoletoCode("");
    setPaymentLink("");
    setAttemptCount(0);
    setBlocked(false);
  }

  async function criarLead(): Promise<string | null> {
    try {
      const utms = getUTMs();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({
          nome: "Lead Iniciado",
          email: "pendente@tesseract.com",
          telefone: "",
          curso_id: cursoId,
          status_pagamento: "pendente",
          ...utms,
          criado_em: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("❌ Erro ao criar lead:", res.status, errText);
        return null;
      }
      const data = await res.json();
      const newLeadId = data?.[0]?.id;
      console.log("✅ Lead criado ao abrir modal:", newLeadId);
      return newLeadId || null;
    } catch (e: any) {
      console.error("❌ Falha ao criar lead:", e);
      return null;
    }
  }

  async function atualizarLeadComDados(leadId: string) {
    if (!leadId) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          nome: formData.nome || "Lead Iniciado",
          email: formData.email || "pendente@tesseract.com",
          telefone: formData.telefone,
        }),
      });
    } catch (e) {
      console.error("Erro ao atualizar lead:", e);
    }
  }

  async function processarPagamento(leadId: string | null, paymentMethod: string) {
    setStatus("loading");
    setErrorMsg("");
    setUltimoMetodo(paymentMethod);

    try {
      const payload: any = {
        transaction_amount: valorTotal,
        payment_method_id: paymentMethod,
        payer: {
          email: formData.email,
          first_name: formData.nome,
        },
        external_reference: leadId || "direto",
        statement_descriptor: "CURSO DIGITAL",
        notification_url: `${SUPABASE_URL}/functions/v1/mp-processar-pagamento`,
      };

      if (selectedBumps.length > 0) {
        payload.bump_curso_ids = selectedBumps;
      }

      if (paymentMethod === "pix") {
        payload.payer.phone = {
          area_code: formData.telefone.replace(/\D/g, "").slice(0, 2),
          number: formData.telefone.replace(/\D/g, "").slice(2),
        };
        if (cpf.replace(/\D/g, "").length === 11) {
          payload.payer.identification = {
            type: "CPF",
            number: cpf.replace(/\D/g, ""),
          };
        }
      }

      if (paymentMethod === "credit_card") {
        payload.installments = parseInt(formData.installment) || 1;

        payload.payer.identification = {
          type: "CPF",
          number: cpf.replace(/\D/g, ""),
        };

        delete payload.payment_method_id;

        const cardNumber = formData.numeroCartao.replace(/\D/g, "");
        const rawValidade = formData.validade.replace(/\D/g, "");
        const expMonth = rawValidade.slice(0, 2) || "12";
        const currentYear = new Date().getFullYear().toString();
        let expYear = rawValidade.slice(2, 6);
        if (expYear.length === 2) {
          expYear = "20" + expYear;
        }
        if (parseInt(expYear) < parseInt(currentYear)) {
          expYear = (parseInt(currentYear) + 1).toString();
        }

        const tokenRes = await fetch("https://api.mercadopago.com/v1/card_tokens?public_key=" + MP_PUBLIC_KEY, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            card_number: cardNumber,
            cardholder: {
              name: formData.nomeCartao
            },
            expiration_month: parseInt(expMonth) || 12,
            expiration_year: expYear || "27",
            security_code: formData.cvv
          })
        });

        const cardToken = await tokenRes.json();

        if (!cardToken?.id) {
          setStatus("error");
          setErrorMsg(cardToken.message || "Dados do cartão inválidos. Verifique e tente novamente.");
          return;
        }

        payload.token = cardToken.id;
        payload.payment_method_id = cardToken.payment_method_id;
        if (cardToken.issuer_id) {
          payload.issuer_id = String(cardToken.issuer_id);
        }
      }

      if (paymentMethod === "boleto") {
        payload.payment_method_id = "bolbradesco";
        const nameParts = formData.nome.trim().split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || firstName;
        payload.payer.first_name = firstName;
        payload.payer.last_name = lastName;
        payload.payer.phone = {
          area_code: formData.telefone.replace(/\D/g, "").slice(0, 2),
          number: formData.telefone.replace(/\D/g, "").slice(2),
        };
        payload.payer.identification = {
          type: "CPF",
          number: cpf.replace(/\D/g, ""),
        };
        payload.payer.address = {
          zip_code: "01001000",
          street_name: "Rua Example",
          street_number: "S/N",
          neighborhood: "Centro",
          city: "Sao Paulo",
          federal_unit: "SP",
        };
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/mp-processar-pagamento`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          ...payload,
          curso_id: cursoId,
          telefone: formData.telefone,
        }),
      });

      const result = await res.json();

      if (result.status === "pending") {
        if (result.payment_method_id === "pix" && result.point_of_interaction?.transaction_data) {
          setPixData({
            qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
            copyPaste: result.point_of_interaction.transaction_data.qr_code,
          });
          setStatus("pending");
        } else if (result.payment_method_id === "bolbradesco" || result.payment_method_id === "boleto" || result.ticket_url) {
          const ticketUrl = result.transaction_details?.payment_method_reference_id || result.payment_method_reference_id || "";
          setPixData({
            qrCodeBase64: "",
            copyPaste: result.ticket_url || result.transaction_details?.external_resource_url || "",
          });
          setBoletoCode(ticketUrl);
          setStatus("pending");
        }
      } else if (result.status === "approved") {
        setAttemptCount(0);
        setStatus("success");
        setTimeout(() => {
          window.location.href = produto?.success_url || "https://robsoliveiradesign.com.br/obrigado-maia/";
        }, 2000);
      } else {
        const novaContagem = attemptCount + 1;
        setAttemptCount(novaContagem);
        const msgDetalhe = getStatusDetailMessage(result.status_detail);
        setStatus("error");
        if (novaContagem >= 5) {
          setBlocked(true);
          setErrorMsg("Você excedeu o limite de tentativas. Use o link abaixo para comprar pelo Asaas.");
        } else {
          setErrorMsg(`${msgDetalhe} (tentativa ${novaContagem} de 5)`);
        }
      }
    } catch (err: any) {
      console.error("Erro no pagamento:", err);
      const novaContagem = attemptCount + 1;
      setAttemptCount(novaContagem);
      setStatus("error");
      if (novaContagem >= 5) {
        setBlocked(true);
        setErrorMsg("Você excedeu o limite de tentativas. Use o link abaixo para comprar pelo Asaas.");
      } else {
        setErrorMsg("Erro ao processar pagamento. Verifique sua conexão e tente novamente.");
      }
    }
  }

  const handleSubmit = async (paymentMethod: string) => {
    if (blocked) {
      setErrorMsg("Limite de tentativas excedido. Use o link abaixo para comprar pelo Asaas.");
      return;
    }
    if (!formData.nome.trim() || !formData.email.trim()) {
      setErrorMsg("Preencha todos os campos obrigatórios.");
      return;
    }
    if (paymentMethod === "pix" && !formData.telefone.trim()) {
      setErrorMsg("Informe o WhatsApp para pagamento PIX.");
      return;
    }
    if (paymentMethod === "boleto" && !formData.telefone.trim()) {
      setErrorMsg("Informe o WhatsApp para pagamento via boleto.");
      return;
    }
    if (paymentMethod === "boleto" && (!cpf.trim() || cpf.replace(/\D/g, "").length < 11)) {
      setErrorMsg("Informe um CPF válido.");
      return;
    }
    if ((paymentMethod === "credit_card" || paymentMethod === "debit_card") &&
      (!formData.numeroCartao.trim() || !formData.nomeCartao.trim() || !formData.validade.trim() || !formData.cvv.trim() || formData.validade.replace(/\D/g, "").length < 6)) {
      setErrorMsg("Preencha todos os dados do cartão. Data de expiração inválida. Correto: MM/AAAA");
      return;
    }
    if ((paymentMethod === "credit_card" || paymentMethod === "debit_card") && (!cpf.trim() || cpf.replace(/\D/g, "").length < 11)) {
      setErrorMsg("Informe um CPF válido.");
      return;
    }

    const utms = getUTMs();
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({
          nome: formData.nome,
          email: formData.email,
          telefone: formData.telefone,
          curso_id: cursoId,
          bump_ids: selectedBumps,
          status_pagamento: "pendente",
          ...utms,
          criado_em: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("❌ Erro ao criar lead:", res.status, errText);
      } else {
        const data = await res.json();
        const newLeadId = data?.[0]?.id;
        console.log("✅ Lead criado com email real:", newLeadId, formData.email);
        setLeadId(newLeadId);
        await processarPagamento(newLeadId, paymentMethod);
        return;
      }
    } catch (e: any) {
      console.error("❌ Falha ao criar lead:", e);
    }

    await processarPagamento(null, paymentMethod);
  };

  useEffect(() => {
    if (isOpen) {
      setStatus("idle");
      setErrorMsg("");
      setPixData(null);
      setLeadId(null);
      setCpf("");
      setBoletoCode("");
      setUltimoMetodo("");
      setFormData({
        nome: "",
        email: "",
        telefone: "",
        numeroCartao: "",
        nomeCartao: "",
        validade: "",
        cvv: "",
        installment: "1",
      });
      setSelectedBumps([]);
      setAllBumps([]);

      fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${cursoId}&select=preco,installments,nome,success_url`, {
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
      })
        .then(r => r.json())
        .then(data => {
          if (data && data[0]) {
            setProduto(data[0]);
          }
        });

      if (BUMP_IDS.length > 0) {
        const idsParam = BUMP_IDS.join(",");
        fetch(`${SUPABASE_URL}/rest/v1/produtos?id=in.(${idsParam})&select=id,preco,nome`, {
          headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
        })
          .then(r => r.json())
          .then(data => {
            if (data && data.length > 0) {
              setAllBumps(data);
            }
          });
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (produto) {
      const valor = produto.preco;
      const win = window as any;
      if (win.fbq) {
        win.fbq('track', 'InitiateCheckout', {
          content_ids: [cursoId],
          content_type: 'product',
          value: valor,
          currency: 'BRL'
        });
      } else {
        win.dataLayer = win.dataLayer || [];
        win.dataLayer.push({
          event: 'initiate_checkout',
          curso_nome: cursoId,
          valor: valor
        });
      }
    }
  }, [produto]);

  if (isOpen === undefined) isOpen = true;

  const maxInstallments = produto?.installments || 3;

const containerClass = asPage 
    ? "min-h-screen flex flex-col items-center justify-center p-4"
    : "fixed inset-0 z-[200] flex items-center justify-center p-4";

  const wrapperClass = asPage
    ? "bg-white rounded-2xl w-full max-w-lg overflow-hidden"
    : "bg-white rounded-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col my-auto";

  return (
    <div className={containerClass} style={{ backgroundColor: '#e6e4e4' }}>
      <div className={wrapperClass}>

        {/* Trust Strip */}
        <div className="bg-white px-4 py-2 flex items-center justify-center gap-2 border-b border-gray-100">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0a0080" strokeWidth="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="text-[10px] font-bold text-[#0a0080] uppercase tracking-widest">
            Pagamento 100% seguro via Mercado Pago
          </span>
        </div>

        {/* Header com logo MP + valor */}
        <div className="bg-white px-5 py-4 flex items-center justify-center gap-6 border-b border-gray-100 relative">
          <div className="flex items-center gap-6">
            <div className="w-36 h-16 flex-shrink-0 flex items-center">
              <img src="https://robsoliveiradesign.com.br/wp-content/uploads/2026/03/logo-mercado-livre-site.png" alt="Mercado Livre" className="h-10 w-auto object-contain" />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest leading-none">Pagamento seguro</p>
              <p className="text-[#0a0080] font-bold text-xl leading-tight">
                R$ {valorTotal.toFixed(2).replace(".", ",")}
              </p>
            </div>
          </div>
        </div>

        {/* Abas */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab("pix")}
            className={`flex-1 py-3 text-sm font-bold uppercase tracking-wider transition ${activeTab === "pix"
              ? "text-[#07b848] border-b-2 border-[#07b848] bg-green-50/30"
              : "text-gray-400 hover:text-gray-600"
              }`}
          >
            PIX
          </button>
          <button
            onClick={() => setActiveTab("cartao")}
            className={`flex-1 py-3 text-sm font-bold uppercase tracking-wider transition ${activeTab === "cartao"
              ? "text-[#07b848] border-b-2 border-[#07b848] bg-green-50/30"
              : "text-gray-400 hover:text-gray-600"
              }`}
          >
            Cartão
          </button>
          <button
            onClick={() => setActiveTab("boleto")}
            className={`flex-1 py-3 text-sm font-bold uppercase tracking-wider transition ${activeTab === "boleto"
              ? "text-[#07b848] border-b-2 border-[#07b848] bg-green-50/30"
              : "text-gray-400 hover:text-gray-600"
              }`}
          >
            Boleto
          </button>
        </div>

        <div className="p-4 md:p-5 overflow-y-auto flex-1 modal-scroll-container" style={{ maxHeight: 'calc(85vh - 200px)' }}>
          {status === "loading" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-10 h-10 border-3 border-[#07b848] border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-500 text-base">Processando pagamento...</p>
            </div>
          )}

          {status === "idle" && (
            <>
              {/* Campos comuns */}
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">Nome Completo *</label>
                  <input
                    type="text"
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    placeholder="Seu nome completo"
                    className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">E-mail *</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="seu@email.com"
                    className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                  />
                </div>
              </div>

              {/* PIX */}
              {activeTab === "pix" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">WhatsApp com DDD *</label>
                    <input
                      type="tel"
                      value={formData.telefone}
                      onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                      placeholder="(00) 00000-0000"
                      className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">CPF <span className="text-gray-400 normal-case font-normal">(opcional, usado para emissão de nota fiscal)</span></label>
                    <input
                      type="text"
                      value={cpf}
                      onChange={(e) => {
                        let val = e.target.value.replace(/\D/g, "").slice(0, 11);
                        val = val.replace(/(\d{3})(\d)/, "$1.$2");
                        val = val.replace(/(\d{3})(\d)/, "$1.$2");
                        val = val.replace(/(\d{3})(\d{2})$/, "$1-$2");
                        setCpf(val);
                      }}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    />
                  </div>

                  {allBumps.map((bump) => {
                    const isSelected = selectedBumps.includes(bump.id);
                    const isAntigravity = bump.id === "antigravity";
                    const isEbookVenderSaas = bump.id === "ebook_como_vender_saas";
                    return (
                      <div
                        key={bump.id}
                        className={`mt-4 border-2 border-dashed rounded-xl p-3 cursor-pointer transition-colors ${isSelected ? "border-[#07b848] bg-green-50" : "border-gray-300 hover:border-[#07b848] hover:bg-green-50"}`}
                        onClick={() => setSelectedBumps(prev => prev.includes(bump.id) ? prev.filter(id => id !== bump.id) : [...prev, bump.id])}
                      >
                        <div className="flex gap-3">
                          <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition-colors mt-0.5 ${isSelected ? "bg-[#07b848] border-[#07b848]" : "bg-white border-2 border-gray-300"}`}>
                            {isSelected && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <img
                            src={isAntigravity ? "https://robsoliveiradesign.com.br/wp-content/uploads/2026/04/Capa-Curso_Antigravity.webp" : isEbookVenderSaas ? "https://robsoliveiradesign.com.br/wp-content/uploads/2026/05/Capa-Como-vender-apps-Vibe-Coding-Copia.webp" : bump.imagem || ""}
                            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                            alt={bump.nome}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="inline-block bg-[#07b848] text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1">
                              {isAntigravity || isEbookVenderSaas ? "ADICIONAR OFERTA" : "Oferta especial"}
                            </span>
                            <p className="text-sm font-bold text-gray-900 leading-tight mb-1">
                              {isAntigravity ? "Antigravity: Do Básico ao Avançado" : isEbookVenderSaas ? "Como vender aplicativos feitos com IA" : bump.nome}
                            </p>
                            <p className="text-xs text-gray-500 leading-snug mb-2">
                              {isAntigravity ? "Aprenda a usar o Google Antigravity para criar apps, sites e sistemas com IA de forma gratuita e ilimitada." : isEbookVenderSaas ? "Guia Estratégico Completo com todo o passo a passo para a venda de SAAS ou apps de IA e conquistar um faturamento milionário." : "Aprimore seus resultados com esta oferta especial."}
                            </p>
                            <p className="text-sm font-bold text-[#07b848]">
                              + R$ {bump.preco.toFixed(2).replace(".", ",")}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Cartão */}
              {activeTab === "cartao" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">WhatsApp com DDD *</label>
                    <input
                      type="tel"
                      value={formData.telefone}
                      onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                      placeholder="(00) 00000-0000"
                      className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">CPF do Titular *</label>
                    <input
                      type="text"
                      value={cpf}
                      onChange={(e) => {
                        let val = e.target.value.replace(/\D/g, "").slice(0, 11);
                        val = val.replace(/(\d{3})(\d)/, "$1.$2");
                        val = val.replace(/(\d{3})(\d)/, "$1.$2");
                        val = val.replace(/(\d{3})(\d{2})$/, "$1-$2");
                        setCpf(val);
                      }}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">Número do Cartão</label>
                    <input
                      type="text"
                      value={formData.numeroCartao}
                      onChange={(e) => {
                        let val = e.target.value.replace(/\D/g, "").slice(0, 16);
                        val = val.replace(/(\d{4})(?=\d)/g, "$1 ");
                        setFormData({ ...formData, numeroCartao: val });
                      }}
                      placeholder="0000 0000 0000 0000"
                      maxLength={19}
                      className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">Nome no Cartão</label>
                    <input
                      type="text"
                      value={formData.nomeCartao}
                      onChange={(e) => setFormData({ ...formData, nomeCartao: e.target.value })}
                      placeholder="Nome como está no cartão"
                      className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    />
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">Validade</label>
                      <input
                        type="text"
                        value={formData.validade}
                        onChange={(e) => {
                          let val = e.target.value.replace(/\D/g, "").slice(0, 6);
                          if (val.length >= 2) val = val.slice(0, 2) + "/" + val.slice(2);
                          setFormData({ ...formData, validade: val });
                        }}
                        placeholder="MM/AAAA"
                        maxLength={7}
                        className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">CVV</label>
                      <input
                        type="text"
                        value={formData.cvv}
                        onChange={(e) => setFormData({ ...formData, cvv: e.target.value })}
                        placeholder="000"
                        className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">Parcelas</label>
                    <select
                      value={formData.installment}
                      onChange={(e) => setFormData({ ...formData, installment: e.target.value })}
                      className="w-full bg-white border border-gray-300 text-gray-800 text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    >
                      {Array.from({ length: maxInstallments }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}x de R$ {(valorTotal / n).toFixed(2).replace(".", ",")} {n > 1 ? "(total R$ " + valorTotal.toFixed(2).replace(".", ",") + ")" : "(sem juros)"}
                        </option>
                      ))}
                    </select>
                  </div>

                  {allBumps.map((bump) => {
                    const isSelected = selectedBumps.includes(bump.id);
                    const isAntigravity = bump.id === "antigravity";
                    const isEbookVenderSaas = bump.id === "ebook_como_vender_saas";
                    return (
                      <div
                        key={bump.id}
                        className={`mt-4 border-2 border-dashed rounded-xl p-3 cursor-pointer transition-colors ${isSelected ? "border-[#07b848] bg-green-50" : "border-gray-300 hover:border-[#07b848] hover:bg-green-50"}`}
                        onClick={() => setSelectedBumps(prev => prev.includes(bump.id) ? prev.filter(id => id !== bump.id) : [...prev, bump.id])}
                      >
                        <div className="flex gap-3">
                          <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition-colors mt-0.5 ${isSelected ? "bg-[#07b848] border-[#07b848]" : "bg-white border-2 border-gray-300"}`}>
                            {isSelected && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <img
                            src={isAntigravity ? "https://robsoliveiradesign.com.br/wp-content/uploads/2026/04/Capa-Curso_Antigravity.webp" : isEbookVenderSaas ? "https://robsoliveiradesign.com.br/wp-content/uploads/2026/05/Capa-Como-vender-apps-Vibe-Coding-Copia.webp" : bump.imagem || ""}
                            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                            alt={bump.nome}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="inline-block bg-[#07b848] text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1">
                              {isAntigravity || isEbookVenderSaas ? "ADICIONAR OFERTA" : "Oferta especial"}
                            </span>
                            <p className="text-sm font-bold text-gray-900 leading-tight mb-1">
                              {isAntigravity ? "Antigravity: Do Básico ao Avançado" : isEbookVenderSaas ? "Como vender aplicativos feitos com IA" : bump.nome}
                            </p>
                            <p className="text-xs text-gray-500 leading-snug mb-2">
                              {isAntigravity ? "Aprenda a usar o Google Antigravity para criar apps, sites e sistemas com IA de forma gratuita e ilimitada." : isEbookVenderSaas ? "Guia Estratégico Completo com todo o passo a passo para a venda de SAAS ou apps de IA e conquistar um faturamento milionário." : "Aprimore seus resultados com esta oferta especial."}
                            </p>
                            <p className="text-sm font-bold text-[#07b848]">
                              + R$ {bump.preco.toFixed(2).replace(".", ",")}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Boleto */}
              {activeTab === "boleto" && (
                <div className="space-y-3">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-yellow-800 text-sm">
                      O boleto será gerado após a confirmação. Você receberá por e-mail e poderá pagar em qualquer banco ou ATM.
                    </p>
                  </div>

                  <div>
                    <label className="text-xs text-[#222222] uppercase tracking-wider font-bold block mb-1">WhatsApp com DDD *</label>
                    <input
                      type="tel"
                      value={formData.telefone}
                      onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                      placeholder="(00) 00000-0000"
                      className="w-full bg-white border border-gray-300 text-[#222222] text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-[#222222] uppercase tracking-wider font-bold block mb-1">CPF *</label>
                    <input
                      type="text"
                      value={cpf}
                      onChange={(e) => {
                        let val = e.target.value.replace(/\D/g, "").slice(0, 11);
                        val = val.replace(/(\d{3})(\d)/, "$1.$2");
                        val = val.replace(/(\d{3})(\d)/, "$1.$2");
                        val = val.replace(/(\d{3})(\d{2})$/, "$1-$2");
                        setCpf(val);
                      }}
                      placeholder="000.000.000-00"
                      className="w-full bg-white border border-gray-300 text-[#222222] text-base p-3 rounded-lg focus:ring-2 focus:ring-[#07b848] focus:border-[#07b848] outline-none transition"
                    />
                  </div>

                  {allBumps.map((bump) => {
                    const isSelected = selectedBumps.includes(bump.id);
                    const isAntigravity = bump.id === "antigravity";
                    const isEbookVenderSaas = bump.id === "ebook_como_vender_saas";
                    return (
                      <div
                        key={bump.id}
                        className={`mt-4 border-2 border-dashed rounded-xl p-3 cursor-pointer transition-colors ${isSelected ? "border-[#07b848] bg-green-50" : "border-gray-300 hover:border-[#07b848] hover:bg-green-50"}`}
                        onClick={() => setSelectedBumps(prev => prev.includes(bump.id) ? prev.filter(id => id !== bump.id) : [...prev, bump.id])}
                      >
                        <div className="flex gap-3">
                          <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition-colors mt-0.5 ${isSelected ? "bg-[#07b848] border-[#07b848]" : "bg-white border-2 border-gray-300"}`}>
                            {isSelected && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <img
                            src={isAntigravity ? "https://robsoliveiradesign.com.br/wp-content/uploads/2026/04/Capa-Curso_Antigravity.webp" : isEbookVenderSaas ? "https://robsoliveiradesign.com.br/wp-content/uploads/2026/05/Capa-Como-vender-apps-Vibe-Coding-Copia.webp" : bump.imagem || ""}
                            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                            alt={bump.nome}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="inline-block bg-[#07b848] text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1">
                              {isAntigravity || isEbookVenderSaas ? "ADICIONAR OFERTA" : "Oferta especial"}
                            </span>
                            <p className="text-sm font-bold text-gray-900 leading-tight mb-1">
                              {isAntigravity ? "Antigravity: Do Básico ao Avançado" : isEbookVenderSaas ? "Como vender aplicativos feitos com IA" : bump.nome}
                            </p>
                            <p className="text-xs text-gray-500 leading-snug mb-2">
                              {isAntigravity ? "Aprenda a usar o Google Antigravity para criar apps, sites e sistemas com IA de forma gratuita e ilimitada." : isEbookVenderSaas ? "Guia Estratégico Completo com todo o passo a passo para a venda de SAAS ou apps de IA e conquistar um faturamento milionário." : "Aprimore seus resultados com esta oferta especial."}
                            </p>
                            <p className="text-sm font-bold text-[#07b848]">
                              + R$ {bump.preco.toFixed(2).replace(".", ",")}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {errorMsg && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{errorMsg}</p>
                  {(errorMsg.includes("recusado") || errorMsg.includes("RECUSADO")) && (
                    <div className="mt-3 pt-3 border-t border-red-200">
                      <p className="text-gray-700 text-sm mb-3">
                        O Mercado Pago recusou seu pagamento, mas você consegue concluir seu ingresso no Asaas:
                      </p>
                      <a
                        href="https://www.asaas.com/c/vxhbhuyjyc1epzq3"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                      >
                        Pagar com Asaas
                        <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <h3 className="text-gray-900 font-bold text-xl mb-1">Pagamento aprovado!</h3>
                <p className="text-gray-500 text-base">Você vai receber o acesso por email em instantes.</p>
              </div>
            </div>
          )}

          {status === "pending" && pixData && (
            <div className="flex flex-col items-center justify-center py-6 gap-5 text-center">
              <div className="w-16 h-16 rounded-full bg-[#07b848]/20 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#07b848" strokeWidth="2.5">
                  <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" />
                  <polyline points="9 11 12 14 15 11" />
                </svg>
              </div>

              <div className="space-y-1">
                <h3 className="text-gray-900 font-bold text-xl">
                  {pixData.qrCodeBase64 ? "Quase lá! Escaneie o QR Code" : "Boleto gerado com sucesso"}
                </h3>
                <p className="text-gray-500 text-base">O acesso é liberado após a confirmação do pagamento.</p>
              </div>

              {pixData.qrCodeBase64 && (
                <div className="bg-white p-3 rounded-2xl shadow-lg">
                  <img
                    src={`data:image/jpeg;base64,${pixData.qrCodeBase64}`}
                    alt="QR Code Pix"
                    className="w-48 h-48"
                  />
                </div>
              )}

              {pixData.copyPaste && pixData.qrCodeBase64 && (
                <div className="w-full max-w-sm space-y-2">
                  <p className="text-gray-500 text-xs uppercase tracking-widest font-bold text-left px-1">Código Copia e Cola</p>
                  <div className="relative flex items-center">
                    <textarea
                      readOnly
                      value={pixData.copyPaste}
                      className="w-full bg-gray-50 border border-gray-200 text-gray-700 text-xs p-3 rounded-xl pr-24 h-24 resize-none"
                    />
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(pixData.copyPaste);
                          alert("Código copiado!");
                        } catch (err) {
                          const textArea = document.createElement("textarea");
                          textArea.value = pixData.copyPaste;
                          document.body.appendChild(textArea);
                          textArea.select();
                          document.execCommand("copy");
                          document.body.removeChild(textArea);
                          alert("Código copiado!");
                        }
                      }}
                      className="absolute right-1 px-3 py-2 bg-[#07b848] text-white text-xs font-bold rounded-lg hover:bg-[#06a03d] transition-colors"
                    >
                      COPIAR
                    </button>
                  </div>
                </div>
              )}

              {pixData.copyPaste && !pixData.qrCodeBase64 && (
                <div className="w-full space-y-4">
                  <a
                    href={pixData.copyPaste}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full px-6 py-3 bg-[#07b848] text-white font-bold rounded-lg hover:bg-[#06a03d] transition text-center"
                  >
                    VISUALIZAR BOLETO
                  </a>
                  {boletoCode && (
                    <div className="bg-gray-100 rounded-lg p-4">
                      <p className="text-xs text-gray-500 uppercase font-bold mb-2">Código do Boleto</p>
                      <div className="relative">
                        <textarea
                          readOnly
                          value={boletoCode}
                          className="w-full bg-white border border-gray-200 text-gray-700 text-xs p-3 rounded-xl pr-20 h-20 resize-none font-mono"
                        />
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(boletoCode);
                              alert("Código copiado!");
                            } catch (err) {
                              const textArea = document.createElement("textarea");
                              textArea.value = boletoCode;
                              document.body.appendChild(textArea);
                              textArea.select();
                              document.execCommand("copy");
                              document.body.removeChild(textArea);
                              alert("Código copiado!");
                            }
                          }}
                          className="absolute right-1 top-1 px-3 py-2 bg-[#07b848] text-white text-xs font-bold rounded-lg hover:bg-[#06a03d] transition"
                        >
                          COPIAR
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => {
                  window.location.href = produto?.success_url || "https://robsoliveiradesign.com.br/obrigado-maia/";
                }}
                className="mt-2 px-6 py-3 bg-[#07b848] text-white font-bold rounded-lg hover:bg-[#06a03d] transition"
              >
                Já fiz o pagamento
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f44336" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <div>
                <h3 className="text-gray-900 font-bold text-xl mb-1">Pagamento não reconhecido</h3>
                <p className="text-gray-500 text-base">{errorMsg}</p>
              </div>
              {!blocked && (
                <div className="flex flex-col gap-3 w-full max-w-xs">
                  <button
                    onClick={() => criarLinkPagamento(leadId)}
                    disabled={loadingLink}
                    className="px-6 py-3 rounded-lg bg-[#07b848] text-white text-base font-bold hover:bg-[#06a03d] transition disabled:opacity-50"
                  >
                    {loadingLink ? "Gerando link..." : "Pagar com Mercado Pago"}
                  </button>
                  <button
                    onClick={tentarNovamente}
                    className="px-6 py-2 rounded-lg border-2 border-gray-300 text-gray-600 text-base font-bold hover:bg-gray-50 transition"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}
              {blocked && (
                <div className="flex flex-col gap-3 w-full max-w-xs">
                  <button
                    onClick={() => criarLinkPagamento(leadId)}
                    disabled={loadingLink}
                    className="px-6 py-3 rounded-lg bg-[#07b848] text-white text-base font-bold hover:bg-[#06a03d] transition disabled:opacity-50"
                  >
                    {loadingLink ? "Gerando link..." : "Pagar com Mercado Pago"}
                  </button>
                </div>
              )}
              {paymentLink && (
                <p className="text-xs text-gray-400">
                  Após o pagamento, seu acesso é liberado automaticamente.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Container fixo para o botão de ação sempre visível */}
        {status === "idle" && (
          <div className="px-4 pb-3 pt-2 bg-white border-t border-gray-100 flex-shrink-0">
            {activeTab === "pix" && (
              <button
                onClick={() => handleSubmit("pix")}
                className="w-full py-4 bg-[#07b848] text-white font-bold text-lg rounded-lg hover:bg-[#06a03d] transition-colors shadow-lg"
              >
                PAGAR COM PIX
              </button>
            )}
            {activeTab === "cartao" && (
              <button
                onClick={() => {
                  if (!cpf.replace(/\D/g, "").length || cpf.replace(/\D/g, "").length < 11) {
                    setErrorMsg("Informe um CPF válido.");
                    return;
                  }
                  setErrorMsg("");
                  handleSubmit("credit_card");
                }}
                className="w-full py-4 bg-[#07b848] text-white font-bold text-lg rounded-lg hover:bg-[#06a03d] transition-colors shadow-lg"
              >
                PAGAR COM CARTÃO
              </button>
            )}
            {activeTab === "boleto" && (
              <button
                onClick={() => {
                  if (!cpf.replace(/\D/g, "").length || cpf.replace(/\D/g, "").length < 11) {
                    setErrorMsg("Informe um CPF válido.");
                    return;
                  }
                  setErrorMsg("");
                  handleSubmit("boleto");
                }}
                className="w-full py-4 bg-[#07b848] text-white font-bold text-lg rounded-lg hover:bg-[#06a03d] transition-colors shadow-lg"
              >
                GERAR BOLETO
              </button>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 pt-5 pb-4 flex items-center justify-center gap-2 flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p className="text-gray-500 text-[10px] sm:text-xs">Ambiente seguro e criptografado</p>
        </div>
      </div>

      {/* FAQ */}
      <div className="mt-8 w-full max-w-lg mx-auto space-y-3">
        <details className="bg-white rounded-xl shadow-md overflow-hidden">
          <summary className="px-5 py-4 cursor-pointer text-sm font-bold text-gray-800 flex items-center justify-between gap-2">
            <span>O pagamento falhou. E agora?</span>
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </summary>
          <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
            Use o link abaixo para comprar pelo Asaas:<br />
            <a href="https://www.asaas.com/c/kxej2c4769vrs6dh" target="_blank" rel="noopener noreferrer" className="text-[#07b848] font-bold underline break-all">https://www.asaas.com/c/kxej2c4769vrs6dh</a>
          </div>
        </details>

        <details className="bg-white rounded-xl shadow-md overflow-hidden">
          <summary className="px-5 py-4 cursor-pointer text-sm font-bold text-gray-800 flex items-center justify-between gap-2">
            <span>Meu pagamento foi recusado. E agora?</span>
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </summary>
          <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
            Se seu pagamento foi recusado, é porque o Mercado Pago encontrou alguma inconsistência. Você pode tentar novamente com os dados corretos. Se ainda assim falhar, tente por este link seguro no Asaas:<br />
            <a href="https://www.asaas.com/c/kxej2c4769vrs6dh" target="_blank" rel="noopener noreferrer" className="text-[#07b848] font-bold underline break-all">https://www.asaas.com/c/kxej2c4769vrs6dh</a>
          </div>
        </details>

        <details className="bg-white rounded-xl shadow-md overflow-hidden">
          <summary className="px-5 py-4 cursor-pointer text-sm font-bold text-gray-800 flex items-center justify-between gap-2">
            <span>Como funciona o pagamento?</span>
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </summary>
          <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
            Oferecemos pagamento via <strong>PIX</strong> (aprovação instantânea) e <strong>Cartão de Crédito</strong> (parcelamento em até 3x). Ambos processados pelo Mercado Pago, uma das maiores plataformas da América Latina. Seu pagamento é 100% seguro e criptografado.
          </div>
        </details>

        <details className="bg-white rounded-xl shadow-md overflow-hidden">
          <summary className="px-5 py-4 cursor-pointer text-sm font-bold text-gray-800 flex items-center justify-between gap-2">
            <span>Meus dados estão seguros?</span>
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </summary>
          <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
            Sim! Todas as informações são processadas diretamente pelo <strong>Mercado Pago</strong> com criptografia de ponta a ponta. Nós nunca armazenamos dados do seu cartão.
          </div>
        </details>

        <details className="bg-white rounded-xl shadow-md overflow-hidden">
          <summary className="px-5 py-4 cursor-pointer text-sm font-bold text-gray-800 flex items-center justify-between gap-2">
            <span>Como recebo o acesso após a compra?</span>
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </summary>
          <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
            Após a confirmação do pagamento, você receberá o acesso por e-mail em instantes. Se não encontrar, verifique sua caixa de <strong>spam</strong> ou <strong>lixeira</strong>.
          </div>
        </details>

        <details className="bg-white rounded-xl shadow-md overflow-hidden">
          <summary className="px-5 py-4 cursor-pointer text-sm font-bold text-gray-800 flex items-center justify-between gap-2">
            <span>Posso parcelar no cartão?</span>
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </summary>
          <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
            Sim! Você pode parcelar em até <strong>3x</strong> no cartão de crédito. As parcelas são processadas diretamente pelo Mercado Pago e aparecem na fatura normalmente.
          </div>
        </details>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return <CheckoutModal isOpen={true} onClose={() => window.history.back()} cursoId="low_ticket_maia_67" asPage={true} />;
}
