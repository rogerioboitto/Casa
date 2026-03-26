import * as functions from "firebase-functions";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

admin.initializeApp();

const ASAAS_BASE_URL = "https://api.asaas.com/v3";

function getApiKey(): string {
    const key = process.env.ASAAS_API_KEY;
    if (key) return key;
    throw new Error("ASAAS_API_KEY not set. Check functions/.env and deployment.");
}

/**
 * Registra eventos de segurança no Firestore
 */
async function logSecurityEvent(event: string, details: any) {
    try {
        await admin.firestore().collection("security_logs").add({
            event,
            details,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (error) {
        logger.error("Erro ao registrar log de segurança:", error);
    }
}

/**
 * Função auxiliar para validar se o usuário está autenticado e na whitelist
 */
async function validateUser(req: functions.https.Request): Promise<{ email: string } | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn("[Security] Tentativa de acesso sem token de autorização.");
        await logSecurityEvent("UNAUTHORIZED_ACCESS_ATTEMPT", {
            ip: req.ip,
            path: req.path,
            reason: "Missing Bearer token"
        });
        return null;
    }

    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const email = decodedToken.email?.toLowerCase();

        if (!email) return null;

        // Verifica na coleção 'allowed_emails' do Firestore
        const allowedDoc = await admin.firestore().collection("allowed_emails").doc(email).get();
        if (!allowedDoc.exists) {
            logger.warn(`[Security] Usuário autenticado mas NÃO autorizado: ${email}`);
            await logSecurityEvent("FORBIDDEN_ACCESS_ATTEMPT", {
                email,
                ip: req.ip,
                path: req.path
            });
            return null;
        }

        return { email };
    } catch (error: any) {
        logger.error("[Security] Erro ao validar token:", error.message);
        return null;
    }
}

export const asaasProxy = functions.https.onRequest(async (req, res) => {
    // CORS handles automatically via our headers, but let's ensure basic headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
    res.set("Access-Control-Allow-Headers", "Content-Type, access_token, Authorization");

    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }

    if (req.path === "/ping") {
        res.status(200).send("Asaas Proxy Production v1.4 is alive!");
        return;
    }

    // --- SEGURANÇA: Validação de usuário ---
    const authenticatedUser = await validateUser(req);
    if (!authenticatedUser) {
        res.status(403).json({
            error: "Acesso negado. Você não tem permissão para realizar operações financeiras.",
            v: "1.4"
        });
        return;
    }
    // ---------------------------------------

    // Firebase Hosting rewrite passa o path completo (ex: /api/asaas/customers)
    // Precisamos remover o prefixo para não duplicar na URL do Asaas
    let sanitizedPath = req.path;
    if (sanitizedPath.startsWith("/api/asaas")) {
        sanitizedPath = sanitizedPath.replace("/api/asaas", "");
    }

    // Garantir que o path não seja vazio
    if (!sanitizedPath || sanitizedPath === "/") {
        res.status(400).json({ error: "Path inválido. Use /customers ou /payments", v: "1.4" });
        return;
    }

    try {
        const apiKey = getApiKey();
        // ASAAS_BASE_URL já tem /v3, sanitizedPath começa com / (ex: /customers)
        const targetUrl = new URL(`${ASAAS_BASE_URL}${sanitizedPath}`);

        // Reconstruir a query string de forma robusta lidando com objetos aninhados
        // (Express transforma dueDate[ge] em req.query.dueDate.ge)
        const appendNestedParams = (obj: any, prefix = "") => {
            for (const key in obj) {
                const value = obj[key];
                const fullKey = prefix ? `${prefix}[${key}]` : key;
                if (value !== null && typeof value === "object") {
                    appendNestedParams(value, fullKey);
                } else if (value !== undefined) {
                    targetUrl.searchParams.append(fullKey, String(value));
                }
            }
        };
        appendNestedParams(req.query);

        const headers: Record<string, string> = {
            "access_token": apiKey.trim(),
            "User-Agent": "BoittoApp/1.0",
            "Accept": "application/json"
        };

        const fetchOptions: any = {
            method: req.method,
            headers: headers,
        };

        // Especial handling for file uploads via Base64 to multipart
        if (req.method === "POST" && req.body && req.body.fileBase64) {
            const { fileBase64, fileName, availableAfterPayment } = req.body;

            // Em Node.js 18+, FormData está disponível globalmente
            const formData = new FormData();

            // Converter base64 para Blob/File. Usando Buffer para compatibilidade Node
            const base64Data = fileBase64.replace(/^data:application\/pdf;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const blob = new Blob([buffer], { type: 'application/pdf' });

            formData.append('file', blob, fileName || 'documento.pdf');
            if (availableAfterPayment !== undefined) {
                formData.append('availableAfterPayment', String(availableAfterPayment));
            }

            fetchOptions.body = formData;
            // O fetch do Node adiciona o Boundary automaticamente se não setarmos Content-Type manualmente
        } else if (req.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && Object.keys(req.body).length > 0) {
            headers["Content-Type"] = "application/json";
            fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl.toString(), fetchOptions);
        const responseText = await response.text();

        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            responseData = {
                rawResponse: responseText,
                debug: {
                    targetUrl: targetUrl.toString(),
                    originalPath: req.path,
                    sanitizedPath: sanitizedPath,
                    v: "1.4"
                }
            };
        }

        if (!response.ok) {
            logger.error(`[AsaasProxy v1.4] Error ${response.status}`, responseData);
            res.status(response.status).json(responseData);
            return;
        }

        res.status(200).json(responseData);
    } catch (error: any) {
        logger.error("[AsaasProxy v1.4] Internal error:", error.message);
        res.status(500).json({ error: error.message, v: "1.4" });
    }
});


export const asaasWebhook = functions.https.onRequest(async (req, res) => {
    // Basic security: only POST is allowed
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }

    try {
        const event = req.body;
        logger.info("[AsaasWebhook] Event received:", event?.event);

        // Events we are interested in
        const targetEvents = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED_IN_CASH"];

        if (targetEvents.includes(event.event)) {
            const payment = event.payment;
            const valueFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(payment.value);

            logger.info("[AsaasWebhook] Fetching push tokens from Firestore...");
            // 1. Get all push tokens from Firestore
            const tokensSnapshot = await admin.firestore().collection("pushTokens").get();
            const tokens = tokensSnapshot.docs.map(doc => doc.data().token).filter(t => !!t);

            logger.info(`[AsaasWebhook] Found ${tokens.length} tokens.`);

            if (tokens.length > 0) {
                const message = {
                    notification: {
                        title: "Pagamento Recebido! 💰",
                        body: `A cobrança de ${valueFormatted} foi paga.`,
                    },
                    data: {
                        paymentId: payment.id,
                        click_action: "FLUTTER_NOTIFICATION_CLICK"
                    },
                    tokens: tokens,
                };

                logger.info("[AsaasWebhook] Sending push notifications via FCM...");
                const response = await admin.messaging().sendEachForMulticast(message);
                logger.info(`[AsaasWebhook] Push notifications result: Success: ${response.successCount}, Failure: ${response.failureCount}`);
            } else {
                logger.warn("[AsaasWebhook] No push tokens found in database.");
            }
        } else {
            logger.info("[AsaasWebhook] Event ignored:", event.event);
        }

        res.status(200).send("OK");
    } catch (error: any) {
        logger.error("[AsaasWebhook] Fatal error processing webhook:", {
            message: error.message,
            code: error.code,
            stack: error.stack
        });
        res.status(500).send(`Internal Error: ${error.message}`);
    }
});

/**
 * Webhook de Validação de Saque/Pix (Aprovação Automática)
 * O Asaas chamará esta função para cada transferência solicitada via API.
 * Retornamos APPROVED para que o Pix saia instantaneamente sem interação manual.
 */
export const asaasApproval = functions.https.onRequest(async (req, res) => {
    // Apenas POST é permitido pelo Asaas
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }

    try {
        const body = req.body;
        logger.info("[AsaasApproval] Pedido de validação recebido:", {
            id: body.id,
            value: body.value,
            operationType: body.operationType
        });

        // Validação do token de segurança (conforme configurado no painel do Asaas)
        const authToken = req.headers["asaas-access-token"];
        if (authToken !== "Rogerio_Luciana") {
            logger.warn("[AsaasApproval] Token inválido ou ausente:", authToken);
            res.status(401).json({
                status: "DENIED",
                observations: "Token de autenticação inválido"
            });
            return;
        }

        // Resposta exigida pelo Asaas para APROVAR a transação
        res.status(200).json({
            status: "APPROVED"
        });

    } catch (error: any) {
        logger.error("[AsaasApproval] Erro na validação:", error.message);
        // Se houver erro, negamos por segurança ou deixamos pendente (depende da lógica)
        res.status(200).json({
            status: "DENIED",
            observations: "Erro interno no servidor de aprovação"
        });
    }
});
