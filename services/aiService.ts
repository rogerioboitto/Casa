import { GoogleGenAI, Type } from "@google/genai";

// Inicializa o cliente Gemini apenas quando necessário para evitar erro de inicialização se a chave estiver ausente
let aiInstance: GoogleGenAI | null = null;

function getAiInstance() {
  if (aiInstance) return aiInstance;

  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    console.warn("Chave de API do Google Gemini não encontrada. Funções de IA estarão desativadas.");
    return null;
  }

  aiInstance = new GoogleGenAI({ apiKey });
  return aiInstance;
}

export const aiService = {
  extractBillData: async (base64Data: string, mimeType: string) => {
    try {
      const cleanBase64 = base64Data.split(',')[1] || base64Data;

      const ai = getAiInstance();
      if (!ai) {
        throw new Error("Chave de API do Google Gemini não configurada. Verifique o arquivo .env.");
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanBase64
              }
            },
            {
              text: `Analise esta fatura de energia elétrica. 
              
              Tarefas:
              1. Extraia o 'Mês de Referência' (formato YYYY-MM).
              
              2. Calcule o 'kwhUnitCost' (Custo Unitário do kWh COM TRIBUTOS). IMPORTANTE:
                 - A conta geralmente divide o consumo em duas linhas: "Consumo Uso Sistema (TUSD)" e "Consumo (TE)".
                 - Você DEVE SOMAR os valores da coluna intitulada "Tarifa com tributos" (ou "Tarifa com Impostos", "Preço Unitário com Tributos") para essas duas linhas.
                 - NÃO use a coluna "Tarifa ANEEL". Use a coluna de valor mais alto por unidade.
                 
              3. Identifique se há cobrança de 'Adicional de Bandeira' (Amarela, Vermelha, Escassez Hídrica).
                 - Se houver, extraia o VALOR TOTAL (R$) cobrado por essa bandeira (não a tarifa unitária, mas o valor final em Reais dessa linha).
                 - Se houver mais de uma linha de bandeira, some os valores.
                 
              4. Identifique se há 'Devolução' ou 'Ressarcimento' na fatura.
                  - Procure por termos como "Devolução", "Crédito", "Ressarcimento", "Bônus" na tabela principal de itens de faturamento (coluna "Descrição da operação").
                  - **CRÍTICO**: Ignore avisos informativos, textos em destaque ou seções de "Aviso Importante". Extraia APENAS se o item for uma linha da tabela de cobrança.
                  - Para o valor, utilize EXATAMENTE o dado correspondente na coluna "Valor total da operação R$" daquela linha.
                  - Se o valor na tabela estiver negativo, extraia o valor absoluto (positivo).

              5. Extraia o 'Código da Instalação' (ou 'Seu Código').
                 - Geralmente localizado no cabeçalho ou topo da fatura.
                 - Retorne apenas os números.`
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              referenceMonth: {
                type: Type.STRING,
                description: "O mês de referência da fatura no formato YYYY-MM (Ex: 2025-01)",
              },
              installationCode: {
                type: Type.STRING,
                description: "O Código da Instalação ou Seu Código presente na fatura.",
              },
              kwhUnitCost: {
                type: Type.NUMBER,
                description: "A soma das tarifas unitárias com tributos (TUSD + TE) do kWh.",
              },
              flagAdditionalCost: {
                type: Type.NUMBER,
                description: "O valor total em R$ cobrado referente a Bandeira Tarifária (Adicional). Se não houver, retorne 0.",
              },
              refundAmount: {
                type: Type.NUMBER,
                description: "O valor total em R$ referente a Devoluções ou Créditos. Se não houver, retorne 0.",
              },
              masterConsumption: {
                type: Type.NUMBER,
                description: "O consumo TOTAL em kWh da fatura principal (CPFL). Geralmente é a soma do consumo TUSD e TE.",
              }
            },
            required: ["referenceMonth", "kwhUnitCost", "masterConsumption"],
          }
        }
      });

      if (response.text) {
        return JSON.parse(response.text);
      }
      throw new Error("Não foi possível extrair dados da fatura.");

    } catch (error) {
      console.error("Erro ao processar fatura com AI:", error);
      throw error;
    }
  },

  extractMeterReading: async (base64Data: string, mimeType: string) => {
    try {
      const cleanBase64 = base64Data.split(',')[1] || base64Data;

      const ai = getAiInstance();
      if (!ai) {
        throw new Error("Chave de API do Google Gemini não configurada.");
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanBase64
              }
            },
            {
              text: `Analise esta foto de um medidor de energia.
              
              Tarefas:
              1. Identifique a LEITURA ATUAL (kWh).
                 - Procure pelos números principais no mostrador digital ou analógico.
                 - Ignore casas decimais menores se houver dúvida, mas tente ser preciso.
                 
              2. Identifique o NÚMERO DE SÉRIE do medidor.
                 - Geralmente impresso no corpo do medidor, próximo a códigos de barra ou com etiquetas como "No.", "Série", "Medidor".
                 - Retorne apenas números e letras, sem símbolos.`
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              currentReading: {
                type: Type.NUMBER,
                description: "A leitura atual do medidor em kWh.",
              },
              meterSerial: {
                type: Type.STRING,
                description: "O número de série ou identificação do medidor.",
              }
            },
            required: ["currentReading"],
          }
        }
      });

      if (response.text) {
        return JSON.parse(response.text);
      }
      throw new Error("Não foi possível extrair leitura do medidor.");

    } catch (error) {
      console.error("Erro ao processar leitura de medidor com AI:", error);
      throw error;
    }
  },

  // --- WATER ---

  extractWaterBillData: async (base64Data: string, mimeType: string) => {
    try {
      const cleanBase64 = base64Data.split(',')[1] || base64Data;

      const ai = getAiInstance();
      if (!ai) {
        throw new Error("Chave de API do Google Gemini não configurada.");
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanBase64
              }
            },
            {
              text: `Analise esta fatura de ÁGUA / SANEAMENTO.
              
              Tarefas:
              1. Extraia o 'Mês de Referência' (formato YYYY-MM).
              
              2. Extraia o 'Valor Total' da fatura (R$).
              
              3. Extraia o 'Consumo Medido' em m³ (Metros Cúbicos).
                 - Procure por "Consumo", "Volume Medido", "Leitura Atual - Leitura Anterior".
                 
              4. Extraia a 'Leitura Atual' do Hidrômetro.
                 - Procure por "Leitura Atual", "Leitura".
                 - Retorne apenas o número (ex: 82).

              5. Extraia o 'Código da Instalação', 'Matrícula', 'RGI' ou 'CDC'.
                 - Retorne o código com formatação (hífens ou pontos, se houver).
                 - Exemplo: "61894-84" ou "123.456-7".
                 - Este campo será usado como identificador da ligação.

              5. Extraia o 'Número do Hidrômetro' ou 'Medidor'.
                 - Procure por "Hidrômetro", "Medidor", "Serial".
                 - Retorne o código alfanumérico.

                 6. Calcule o custo por m³ ('m3UnitCost') com a seguinte FÓRMULA RESTRITA:
                 - SOMAR APENAS: 
                   (a) "T. Água"
                   (b) "T. Afastamento" (ou Coleta/Afastamento Esgoto)
                   (c) "Tratam. Esgoto" (ou Tratamento)
                 - IGNORAR/EXCLUIR QUALQUER OUTRO VALOR: Não some "Multa", "Juros", "Correção", "Taxa Lixo" ou outros serviços. Apenas os 3 itens acima.
                 - DIVIDIR a soma pelo "Consumo Faturado" (m³).
                 - ARREDONDAR o resultado para 2 casas decimais.`
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              referenceMonth: { type: Type.STRING },
              installationCode: { type: Type.STRING },
              meterSerial: { type: Type.STRING },
              totalAmount: { type: Type.NUMBER },
              masterConsumption: { type: Type.NUMBER },
              currentReading: { type: Type.NUMBER },
              m3UnitCost: { type: Type.NUMBER }
            },
            required: ["referenceMonth", "totalAmount"],
          }
        }
      });

      if (response.text) return JSON.parse(response.text);
      throw new Error("Não foi possível extrair dados da fatura de água.");

    } catch (error) {
      console.error("Erro ao processar fatura de água com AI:", error);
      throw error;
    }
  },

  extractWaterMeterReading: async (base64Data: string, mimeType: string) => {
    try {
      const cleanBase64 = base64Data.split(',')[1] || base64Data;

      const ai = getAiInstance();
      if (!ai) throw new Error("API Key inválida.");

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { inlineData: { mimeType, data: cleanBase64 } },
            {
              text: `Analise esta foto de um HIDRÔMETRO (Medidor de Água).
              
              Tarefas:
              1. Identifique a LEITURA ATUAL do medidor.
                 - **CRÍTICO: DIFERENCIAÇÃO DE BARRA vs NÚMERO 1**
                   - Alguns modelos (como **Akvometer**) possuem divisórias verticais grossas entre os dígitos.
                   - **NÃO LEIA ESSAS DIVISÓRIAS COMO O NÚMERO 1.**
                   - EXEMPLO DE ERRO COMUM: Ler "01013" quando na verdade é "003" (com barras entre os zeros).
                   - DICA VISUAL: O número 1 tem serifa (tracinho em cima). A barra de divisão é apenas um retângulo reto.
                   - Se você ver um padrão repetitivo de "1" entre outros números (ex: 01012), considere fortemente que são divisórias.

                 - **REGRAS DE FORMATAÇÃO (4.3)**:
                   - IDENTIFIQUE O PONTO DECIMAL.
                   - Considere 4 DÍGITOS à esquerda do ponto (Parte Inteira). Se visível menos, preencha com zeros à esquerda.
                   - Considere 3 DÍGITOS à direita do ponto (Parte Fracionária).
                 - VISUALIZAÇÃO COMUM:
                   - 4 Dígitos Inteiros | PONTO | 3 Dígitos Decimais
                 - IGNORAR:
                   - Dígitos extras girando no final.
                   - Barras verticais que pareçam "1".
                 - Retorne:
                    - blackDigits: A parte inteira formatada com 4 dígitos (ex: "0003")
                    - redDigits: A parte decimal com 3 dígitos (ex: "121")
                    - currentReading: O valor numérico float final (ex: 3.121)
              
              2. Identifique o NÚMERO DE SÉRIE do hidrômetro.
                 - PRIORIDADE MÁXIMA: Procure pela ETIQUETA ADESIVA BRANCA colada na tampa azul do medidor.
                 - O código geralmente está sob um código de barras.
                 - Retorne o código alfanumérico completo encontrado.`
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              currentReading: { type: Type.NUMBER },
              blackDigits: { type: Type.STRING },
              redDigits: { type: Type.STRING },
              meterSerial: { type: Type.STRING }
            },
            required: ["currentReading"]
          }
        }
      });

      if (response.text) return JSON.parse(response.text);
      throw new Error("Erro ao ler hidrômetro.");

    } catch (error) {
      console.error("Erro AI Hidrômetro:", error);
      throw error;
    }
  }
};