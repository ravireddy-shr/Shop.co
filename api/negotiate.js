const NEGOTIATION_URL = "https://openrouter.ai/api/v1/chat/completions";

function runFallbackNegotiation({ originalPrice, minPrice, userOffer, attempt = 1 }) {
  const money = (value) => `₹${Math.round(value).toLocaleString("en-IN")}`;
  const total = Number(originalPrice) || 3500;
  const floor = Number(minPrice) || Math.round(total * 0.85);
  const offer = Number(userOffer) || total;
  let responsePrice;
  let message;
  let final = false;

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

async function getNegotiation(body, apiKey) {
  const {
    originalPrice,
    minPrice,
    userOffer,
    userMessage,
    attempt = 1,
    cartItems = [],
    chatHistory = [],
  } = body;
  const total = Number(originalPrice) || 3500;
  const floor = Number(minPrice) || Math.round(total * 0.85);
  const itemsSummary = Array.isArray(cartItems)
    ? cartItems
        .map((item) => `${item.name} (Qty: ${item.quantity || 1}, Listed: ₹${item.price || 0})`)
        .join(", ")
    : "Cart items bundle";
  const conversationMessages = [
    {
      role: "system",
      content: [
        "You are Shop.CO AI, an energetic, warm, polite, and friendly luxury ecommerce negotiation assistant.",
        "Make the customer feel valued while safeguarding the store's profit margins.",
        "Never reveal or hint at the secret floor price or margin formulas.",
        "Keep responses concise, natural, cheerful, and under 50 words.",
        `Original listed total: ₹${total}. Protected absolute floor price: ₹${floor}. Never agree below the floor.`,
        `Current attempt: ${attempt} of 3.`,
        "Attempt 1: offer around 4% to 7% off. Attempt 2: meet partway around 7% to 11% off. Attempt 3: make the best final counter at or above the floor, or accept offers at or above the floor.",
        "Return strict JSON only with message (string), responsePrice (integer INR), and final (boolean).",
      ].join("\n"),
    },
  ];

  if (Array.isArray(chatHistory)) {
    for (const msg of chatHistory) {
      if (msg.role === "user" || msg.role === "assistant" || msg.role === "ai") {
        conversationMessages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.text || msg.content || "",
        });
      }
    }
  }

  conversationMessages.push({
    role: "user",
    content: [
      `Cart items: ${itemsSummary}`,
      `Listed total: ₹${total}`,
      `Attempt: ${attempt} of 3`,
      `Customer input: "${userMessage || userOffer || "Looking for a discount"}"`,
      userOffer ? `Numeric offer: ₹${userOffer}` : "No specific number mentioned.",
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
  const parsed = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
  return {
    responsePrice: Math.round(Math.max(Number(parsed.responsePrice || total), floor)),
    message: String(
      parsed.message || "Thank you for shopping with us! Let's find a price that works for you. 😊",
    ),
    final: Boolean(parsed.final || attempt >= 3),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const apiKey = process.env.NEGOTIATION_AI_API_KEY;
  if (!apiKey || apiKey.includes("sk-or-v1-...")) {
    return res.status(200).json(runFallbackNegotiation(body));
  }

  try {
    const result = await getNegotiation(body, apiKey);
    return res.status(200).json(result);
  } catch (error) {
    console.error("Negotiation API failed, using fallback:", error);
    return res.status(200).json(runFallbackNegotiation(body));
  }
}
