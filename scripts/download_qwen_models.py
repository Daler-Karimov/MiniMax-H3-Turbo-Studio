import os
import shutil
from pathlib import Path
from huggingface_hub import hf_hub_download

REPO_ID = "abenzerps/Qwen-Image-2.1-Uncensored-Quantized"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = PROJECT_ROOT / "SwarmUI" / "dlbackend" / "comfy" / "ComfyUI" / "models"
os.environ.setdefault("HF_HOME", str(PROJECT_ROOT / "cache" / "huggingface"))

TARGETS = [
    {
        "filename": "qwen-image-2.1-UC-Q4_K_M.gguf",
        "dest_dir": MODELS_DIR / "diffusion_models",
        "dest_file": "qwen-image-2.1-UC-Q4_K_M.gguf",
        "label": "Diffusion Model (GGUF Q4_K_M ~4.6 GB)",
        "min_size": 4_000_000_000,
    },
    {
        "filename": "text_encoders/qwen3vl_8b_int8_convrot.safetensors",
        "dest_dir": MODELS_DIR / "text_encoders",
        "dest_file": "qwen3vl_8b_int8_convrot.safetensors",
        "label": "Text Encoder (Qwen3-VL 8B Int8 ~9.35 GB)",
        "min_size": 9_000_000_000,
    },
    {
        "filename": "vae/qwen_image_2.1_vae_bf16.safetensors",
        "dest_dir": MODELS_DIR / "vae",
        "dest_file": "qwen_image_2.1_vae_bf16.safetensors",
        "label": "VAE (BF16 ~676 MB)",
        "min_size": 600_000_000,
    },
]

def main():
    print("=" * 70)
    print("  Qwen-Image-2.1 Uncensored Quantized: Model Downloader")
    print(f"  Target directory: {MODELS_DIR}")
    print("=" * 70)

    for item in TARGETS:
        dest_path = item["dest_dir"] / item["dest_file"]
        item["dest_dir"].mkdir(parents=True, exist_ok=True)

        if dest_path.exists() and dest_path.stat().st_size >= item["min_size"]:
            size_gb = dest_path.stat().st_size / (1024**3)
            print(f"\n[SKIP] {item['label']} already present ({size_gb:.2f} GB).")
            continue

        print(f"\n[DOWNLOADING] {item['label']}...")
        print(f"Source: {REPO_ID} / {item['filename']}")
        temp_download = hf_hub_download(
            repo_id=REPO_ID,
            filename=item["filename"],
            resume_download=True,
        )

        # Move or copy into place
        if Path(temp_download) != dest_path:
            print(f"Placing into: {dest_path}")
            shutil.copy2(temp_download, dest_path)

        size_gb = dest_path.stat().st_size / (1024**3)
        print(f"[OK] Successfully installed ({size_gb:.2f} GB): {dest_path.name}")

    print("\n" + "=" * 70)
    print("  All companion model weights are successfully downloaded and placed!")
    print("=" * 70)

if __name__ == "__main__":
    main()
