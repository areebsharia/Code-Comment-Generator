"""
Inference server for Code-Comment Generator.

Loads the fine-tuned CodeT5 model produced by the training notebook and serves
predictions over HTTP. The VS Code extension calls POST /generate.

Run locally:
    python server.py

In Colab (with ngrok), the training notebook has a deployment cell that wraps
this same FastAPI app and exposes it via a public ngrok tunnel.
"""

import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import T5ForConditionalGeneration, RobertaTokenizer

MODEL_DIR = "codet5-finetuned"
MAX_SOURCE_LENGTH = 256
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

print(f"Loading model from {MODEL_DIR} on {DEVICE}...")
tokenizer = RobertaTokenizer.from_pretrained(MODEL_DIR)
model = T5ForConditionalGeneration.from_pretrained(MODEL_DIR).to(DEVICE).eval()
print("Model loaded.")


class CommentRequest(BaseModel):
    code: str
    max_length: int = 64
    num_beams: int = 4


class CommentResponse(BaseModel):
    comment: str


app = FastAPI(title="Code-Comment Generator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "device": str(DEVICE)}


@app.post("/generate", response_model=CommentResponse)
@torch.no_grad()
def generate(req: CommentRequest):
    inputs = tokenizer(
        req.code,
        return_tensors="pt",
        max_length=MAX_SOURCE_LENGTH,
        truncation=True,
    ).to(DEVICE)
    out = model.generate(
        **inputs,
        max_length=req.max_length,
        num_beams=req.num_beams,
        early_stopping=True,
        no_repeat_ngram_size=3,
    )
    comment = tokenizer.decode(out[0], skip_special_tokens=True)
    return CommentResponse(comment=comment)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
