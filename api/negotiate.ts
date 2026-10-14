import {
  handleNegotiationRequest,
  type NegotiationRequest,
} from "../src/server/negotiation.ts";

interface VercelRequest {
  method?: string;
  body?: NegotiationRequest;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const result = await handleNegotiationRequest(req.body ?? {});
  return res.status(200).json(result);
}
