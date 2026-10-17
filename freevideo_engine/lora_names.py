"""Names a LoRA file uses for the FreeVideo model, shared by the engine and the pre-check."""
import re


def _targets(name):
    prefixes = ('base_model.model.', 'diffusion_model.', 'model.diffusion_model.', 'transformer.')
    while any(name.startswith(prefix) for prefix in prefixes):
        prefix = next(prefix for prefix in prefixes if name.startswith(prefix))
        name = name[len(prefix):]
    # Community H3 trainers also export Kohya-style flattened module names.
    # Only the known H3 block grammar is expanded; underscores inside qkv_proj
    # and out_proj are meaningful and must not become dots.
    name = re.sub(r'^lora_unet_blocks_(\d+)_(attn|mlp)_(out_proj|qkv_proj|fc1|fc2)(?=\.|$)',
                  r'blocks.\1.\2.\3', name)
    name = re.sub(r'^blocks\.', 'transformer_blocks.', name)
    name = name.replace('token_refiner.blocks.', 'token_refiner.refiner_blocks.')
    name = name.replace('final_layer.adaln_proj.linear', 'norm_out.linear')
    # Original H3 fc1 uses [gate; value], including token-refiner MLPs.
    # Diffusers adapters already name ff.net.0.proj and need no swap.
    swap = '.mlp.fc1' in name
    for before, after in (('.mlp.fc1', '.ff.net.0.proj'), ('.mlp.fc2', '.ff.net.2'), ('.attn.out_proj', '.attn.to_out.0')):
        name = name.replace(before, after)
    if '.attn.qkv_proj' in name:
        return [(name.replace('.attn.qkv_proj', '.attn.' + suffix), i, False) for i, suffix in enumerate(('to_q', 'to_k', 'to_v'))]
    return [(name, None, swap)]
