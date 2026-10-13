"""Optional ComfyUI custom-node entry point; the engine also runs standalone."""
WEB_DIRECTORY = './web'


async def comfy_entrypoint():
    from .freevideo_engine.comfy_progress import register as progress_routes
    progress_routes()
    try:
        from .freevideo_engine.comfy_chain import register as chain_routes
        chain_routes()
    except Exception as error:
        import logging
        logging.warning('[FreeVideo] Chain routes not registered: %s', error)
    from .freevideo_engine.comfy_upload import register
    register()
    from .freevideo_engine.comfy_setup import register as setup_routes
    setup_routes()
    from .freevideo_engine.prompt_vlm.service import register as prompt_routes
    prompt_routes()
    from .freevideo_engine.comfy_launcher_api import register as launcher_routes
    launcher_routes()
    from .freevideo_engine.comfy_updates import register as update_routes
    update_routes()
    from .freevideo_engine.comfy_library import register as library_routes
    library_routes()
    from .freevideo_engine.comfy_editor import register as editor_routes
    editor_routes()
    from .freevideo_engine.editor_export import register as editor_export_routes
    editor_export_routes()
    from .freevideo_engine.comfy_capabilities import register as capabilities_routes
    capabilities_routes()
    from .freevideo_engine.comfy_share import register as share_routes
    share_routes()
    from .freevideo_engine.comfy_metadata import register as workflow_backfill
    workflow_backfill()
    try:
        from .freevideo_engine.agent.routes import register as agent_routes
        agent_routes()
    except Exception as error:
        import logging
        logging.warning('[FreeVideo] Agent routes not registered: %s', error)
    from .freevideo_engine.comfy_nodes import FreeVideoExtension
    return FreeVideoExtension()
