import express from "express";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.get("/api/ping", (_req, res) => {
  res.json({ code: 0, data: "ok" });
});

app.listen(port, () => {
  console.log(`zhikang server listening on http://localhost:${port}`);
});
