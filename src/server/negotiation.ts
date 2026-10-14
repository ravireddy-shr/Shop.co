const NEGOTIATION_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface NegotiationRequest {
  originalPrice?: number;
  minPrice?: number;
  userOffer?: number | null;
  userMessage?: string;
  attempt?: number;
  cartItems?: Array<{
    name?: string;
    price?: number;
    quantity?: number;
    discountPercentage?: number;
  }>;
  chatHistory?: Array<{
    role?: string;
    text?: string;
    content?: string;
  }>;
}

function runFallbackNegotiation({
  originalPrice,
  minPrice,
  userOffer,
  attempt,
}: NegotiationRequest) {
  const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
  const total = Number(originalPrice) || 3500;
  const floor = Number(minPrice) || Math.round(total * 0.85);
  let responsePrice = total;
  let message = "";
  let final = false;

  const offer = Number(userOffer) || total;

  if (attempt === 1) {
    responsePrice = Math.max(Math.round(total * 0.94), floor + 150);
    message = `Thank you so much for your offer! 😊 We love having you with us. For this wonderful bundle, I can offer a special courtesy price of ${money(responsePrice)}. How does that sound to you? 🛍️`;
  } else if (attempt === 2) {
    if (offer >= floor) {
      responsePrice = Math.max(offer, floor);
      message = `You drive a great bargain! ✨ Because we'd love for you to enjoy these items, I can do ${money(responsePrice)}. Deal? 🎉`;
    } else {
      responsePrice = Math.max(Math.round(total * 0.9), floor + 50);
      message = `I truly appreciate your interest! While ${money(offer)} is a bit too low for these premium pieces, my best compromise for you right now is ${money(responsePrice)}. Let's make this work for you! 🌟`;
    }
  } else {
    final = true;
    if (offer >= floor) {
      responsePrice = offer;
      message = `You have a deal! 🎉 We're thrilled to give you this bundle for ${money(responsePrice)}. Enjoy your shopping with us! ✨`;
    } else {
      responsePrice = floor;
      message = `As my absolute best final courtesy for this order, I can do ${money(responsePrice)}. This is the finest offer we can provide today! 🎁`;
    }
  }

  return { responsePrice: Math.round(responsePrice), message, final };
}

async function negotiateWithApi(
  apiKey: string,
  {
    originalPrice,
    minPrice,
    userOffer,
    userMessage,
    attempt,
    cartItems = [],
    chatHistory = [],
  }: NegotiationRequest,
) {
  const total = Number(originalPrice) || 3500;
  const floor = Number(minPrice) || Math.round(total * 0.85);
  const itemsSummary = Array.isArray(cartItems)
    ? cartItems
        .map((item) => `${item.name} (Qty: ${item.quantity || 1}, Listed: ₹${item.price || 0})`)
        .join(", ")
    : "Cart items bundle";

  const systemPrompt = [
    "You are Shop.CO AI, an energetic, warm, polite, and friendly luxury ecommerce negotiation assistant.",
    "Your mission is to make the customer feel valued, delighted, and heard, while smartly safeguarding the store's profit margins.",
    "Carefully observe what the customer says (their reasons, thoughts, excitement, or budget) and chat warmly with them like a top-tier store manager.",
    "CRITICAL SECURITY RULE: NEVER reveal, mention, or hint at any secret floor price, minimum price, or margin formulas to the customer under any circumstances.",
    "Always maintain a cheerful, positive tone with polite language and delightful emojis (e.g., 😊, 🛍️, ✨, 🌟, 🎉).",
    "Keep responses concise (under 50 words), natural, and engaging.",
    "Store Business Rules:",
    `- Original Listed Total: ₹${total}`,
    `- Protected Absolute Floor Price: ₹${floor} (You MUST NEVER agree to a final price below this floor price under any condition).`,
    `- Current Attempt: ${attempt} of 3.`,
    "- On Attempt 1: Offer an initial friendly courtesy discount (around 4% to 7% off listed total) while complimenting their taste.",
    "- On Attempt 2: If the customer asks for a better price, meet them gracefully partway (around 7% to 11% off), staying comfortably above the floor.",
    "- On Attempt 3 / Final: Make your best final counter close to or at the floor, OR if their offer is >= floor, warmly accept it and lock it in.",
    "- If customer offers an amount >= floor that is close to your range, accept enthusiastically!",
    "- If customer offers below floor, politely explain the premium quality and value of the items and counter at or above the floor.",
    "Return STRICT JSON ONLY with the exact keys: message (string), responsePrice (integer number in INR), final (boolean).",
  ].join("\n");

  const conversationMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of chatHistory) {
    if (msg.role === "user" || msg.role === "assistant" || msg.role === "ai") {
      conversationMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.text || msg.content || "",
      });
    }
  }

  conversationMessages.push({
    role: "user",
    content: [
      `Cart Bundle Items: ${itemsSummary}`,
      `Listed Total: ₹${total}`,
      `Attempt: ${attempt} of 3`,
      `Customer Input: "${userMessage || userOffer || "Looking for a discount"}"`,
      userOffer
        ? `Numeric Offer: ₹${userOffer}`
        : "No specific number mentioned, customer requested a discount.",
    ].join("\n"),
  });

  const response = await fetch(NEGOTIATION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-Title": "Shop.CO",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      max_tokens: 280,
      temperature: 0.7,
      messages: conversationMessages,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`Negotiation API error ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  const responsePrice = Math.max(Number(parsed.responsePrice || total), floor);

  return {
    responsePrice: Math.round(responsePrice),
    message: String(
      parsed.message || "Thank you for shopping with us! Let's find a price that works for you. 😊",
    ),
    final: Boolean(parsed.final || (attempt ?? 0) >= 3),
  };
}

export async function handleNegotiationRequest(body: NegotiationRequest) {
  const apiKey = process.env.NEGOTIATION_AI_API_KEY;
  if (!apiKey || apiKey.includes("sk-or-v1-...")) {
    return runFallbackNegotiation(body);
  }

  try {
    return await negotiateWithApi(apiKey, body);
  } catch (error) {
    console.error("Negotiation API failed, using fallback:", error);
    return runFallbackNegotiation(body);
  }
}
