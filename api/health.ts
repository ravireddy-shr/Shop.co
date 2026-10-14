interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

export default function handler(_req: unknown, res: VercelResponse) {
  return res.status(200).json({ status: "ok" });
}
