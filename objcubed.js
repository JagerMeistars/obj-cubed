(function () {
    'use strict';

    const PLUGIN_ID = 'objcubed';

    // =========================================================
    // Constants (HOISTED — must be declared before Plugin Registration
    // so that the Vue dialog component, which captures them via closure,
    // sees them initialized regardless of any pre-render passes Blockbench
    // performs on component.data() during plugin install.)
    // =========================================================

    // Fields that are user-configurable and should persist between sessions.
    // Anything not in this list (texOptions, hasAnims, status, etc.) stays
    // ephemeral.
    // One-shot Display-editor pull handoff: uuid of the project whose export
    // dialog should read back Project.display_settings on next open.
    let pullDisplayForProject = null;
    const PERSISTABLE_FIELDS = [
        // Texture
        'selectedTex', 'useAtlas', 'atlasTexChecked',
        'texAnimEnabled', 'texFrametime', 'texFade',
        // Transform
        'scale', 'offsetX', 'offsetY', 'offsetZ',
        // Animation
        'animationEnabled', 'animationIndex', 'animFps', 'animStart', 'animEnd',
        'autoplay',
        // Datapack
        'generateDatapack', 'datapackNamespace', 'datapackAnimId',
        'datapackTargetType', 'datapackEquipSlot', 'datapackOutputDir',
        // Output paths
        'resourcePackDir', 'baseItem', 'cmdName',
        // Equipment (armor) export — Approach C
        'exportAsEquipment', 'equipmentSlot', 'selectedPieces',
        // Display — right hand & shared
        'useSeparateLefthand',
        'dThirdRX','dThirdRY','dThirdRZ','dThirdTX','dThirdTY','dThirdTZ','dThirdSX','dThirdSY','dThirdSZ',
        // Display — left hand (independent third-person, when useSeparateLefthand=true)
        'dLeftRX','dLeftRY','dLeftRZ','dLeftTX','dLeftTY','dLeftTZ','dLeftSX','dLeftSY','dLeftSZ',
        // Display — head/ground/fixed
        'dHeadRX','dHeadRY','dHeadRZ','dHeadTX','dHeadTY','dHeadTZ','dHeadSX','dHeadSY','dHeadSZ',
        'dGroundRX','dGroundRY','dGroundRZ','dGroundTX','dGroundTY','dGroundTZ','dGroundSX','dGroundSY','dGroundSZ',
        'dFixedRX','dFixedRY','dFixedRZ','dFixedTX','dFixedTY','dFixedTZ','dFixedSX','dFixedSY','dFixedSZ',
        // Display — GUI, first-person hands, on_shelf
        'dGuiRX','dGuiRY','dGuiRZ','dGuiTX','dGuiTY','dGuiTZ','dGuiSX','dGuiSY','dGuiSZ',
        'dGuiPX','dGuiPY','dGuiPZ',
        'dFprRX','dFprRY','dFprRZ','dFprTX','dFprTY','dFprTZ','dFprSX','dFprSY','dFprSZ',
        'dFplRX','dFplRY','dFplRZ','dFplTX','dFplTY','dFplTZ','dFplSX','dFplSY','dFplSZ',
        'dShelfRX','dShelfRY','dShelfRZ','dShelfTX','dShelfTY','dShelfTZ','dShelfSX','dShelfSY','dShelfSZ',
        // Color & Tinting
        'cbR', 'cbG', 'cbB',
        // Advanced
        'easing', 'interpolation', 'autorotate',
        'flipuv', 'noshadow', 'nopow', 'filterArmature',
    ];

    // Global UI-scale (issue #6). Stored in GLOBAL localStorage, NOT in the
    // per-project preset system — it's a viewer preference, not model data.
    // Intentionally absent from PERSISTABLE_FIELDS.
    // Issue #6: the export dialog renders at a fixed enlarged scale. The whole
    // stylesheet (and every inline font-size) reads var(--oc-scale); we pin that
    // var to UI_SCALE on .oc-root and the tooltip portal, so a future bump is a
    // one-line change. No per-user toggle — the smaller sizes weren't needed.
    const UI_SCALE = 1.25;

    // Guided tour (issue #4) — canonical step list (single source of truth).
    // The dialog closure derives its `tourSteps` from this; sel is the DOM
    // marker resolved at run time (null = centered card, '__export__' = the
    // native dialog-bar Export button). titleKey/bodyKey must exist in BOTH
    // LANG.en and LANG.ru (enforced by test/unit/tour-i18n.test.mjs).
    // Steps are ordered to match the dialog's visual top-to-bottom flow, so the
    // tour scrolls in one direction. requiresAnims drops a step when the model
    // has no animations; reveal turns a hidden section on before measuring so
    // its anchor exists (restored in tourEnd). One step per meaningful control.
    const TOUR_STEPS = [
        { sel: null,                      titleKey: 'tour_t_welcome',       bodyKey: 'tour_b_welcome'       },
        // ── Texture card ──
        { sel: '.oc-tour-texture',        titleKey: 'tour_t_texture',       bodyKey: 'tour_b_texture'       },
        // atlas toggle only renders for multi-texture models; positionTour()
        // centers the card harmlessly when the anchor is absent.
        { sel: '.oc-tour-atlas',          titleKey: 'tour_t_atlas',         bodyKey: 'tour_b_atlas'         },
        // texAnim block only renders when a frame-strip texture is present;
        // positionTour() centers the card harmlessly when the anchor is absent.
        { sel: '.oc-tour-texanim',        titleKey: 'tour_t_texanim',       bodyKey: 'tour_b_texanim'       },
        // ── Display card ──
        { sel: '.oc-display-tabs',        titleKey: 'tour_t_display',       bodyKey: 'tour_b_display'       },
        { sel: '.oc-tour-preview',        titleKey: 'tour_t_preview',       bodyKey: 'tour_b_preview'       },
        // third-person transform row is v-show-gated by displayTab; reveal opens it.
        { sel: '.oc-tour-thirdrow',       titleKey: 'tour_t_transform',     bodyKey: 'tour_b_transform',     reveal: { displayTab: 'third' } },
        // ── Behavior: animation block (all inside v-if="hasAnims && animationEnabled") ──
        { sel: '.oc-tour-animation',      titleKey: 'tour_t_animation',     bodyKey: 'tour_b_animation'     },
        { sel: '.oc-tour-animselect',     titleKey: 'tour_t_animselect',    bodyKey: 'tour_b_animselect',    requiresAnims: true, reveal: { animationEnabled: true } },
        { sel: '.oc-tour-fps',            titleKey: 'tour_t_fps',           bodyKey: 'tour_b_fps',           requiresAnims: true, reveal: { animationEnabled: true } },
        { sel: '.oc-tour-range',          titleKey: 'tour_t_range',         bodyKey: 'tour_b_range',         requiresAnims: true, reveal: { animationEnabled: true } },
        { sel: '.oc-tour-autoplay',       titleKey: 'tour_t_autoplay',      bodyKey: 'tour_b_autoplay',      requiresAnims: true, reveal: { animationEnabled: true } },
        { sel: '.oc-tour-datapack',       titleKey: 'tour_t_datapack',      bodyKey: 'tour_b_datapack',      requiresAnims: true, reveal: { animationEnabled: true } },
        // datapack fields live inside v-if="generateDatapack"; reveal both flags.
        { sel: '.oc-tour-datapackid',     titleKey: 'tour_t_datapackid',    bodyKey: 'tour_b_datapackid',    requiresAnims: true, reveal: { animationEnabled: true, generateDatapack: true } },
        { sel: '.oc-tour-datapacktarget', titleKey: 'tour_t_datapacktarget',bodyKey: 'tour_b_datapacktarget',requiresAnims: true, reveal: { animationEnabled: true, generateDatapack: true } },
        // ── Behavior: output sub-section ──
        { sel: '.oc-tour-respack',        titleKey: 'tour_t_respack',       bodyKey: 'tour_b_respack'       },
        { sel: '.oc-tour-baseitem',       titleKey: 'tour_t_baseitem',      bodyKey: 'tour_b_baseitem'      },
        { sel: '.oc-tour-cmdname',        titleKey: 'tour_t_cmdname',       bodyKey: 'tour_b_cmdname'       },
        { sel: '.oc-tour-equipment',      titleKey: 'tour_t_equipment',     bodyKey: 'tour_b_equipment'     },
        // equip slot select is v-if="exportAsEquipment"; reveal opens it.
        { sel: '.oc-tour-equipslot',      titleKey: 'tour_t_equipslot',     bodyKey: 'tour_b_equipslot',     reveal: { exportAsEquipment: true } },
        // ── Behavior: color & advanced ──
        { sel: '.oc-tour-color',          titleKey: 'tour_t_color',         bodyKey: 'tour_b_color'         },
        { sel: '.oc-tour-easing',         titleKey: 'tour_t_easing',        bodyKey: 'tour_b_easing'        },
        { sel: '.oc-tour-interpolation',  titleKey: 'tour_t_interpolation', bodyKey: 'tour_b_interpolation' },
        { sel: '.oc-tour-autorotate',     titleKey: 'tour_t_autorotate',    bodyKey: 'tour_b_autorotate'    },
        { sel: '.oc-tour-flags',          titleKey: 'tour_t_flags',         bodyKey: 'tour_b_flags'         },
        { sel: '__export__',              titleKey: 'tour_t_export',        bodyKey: 'tour_b_export'        },
    ];
    // Flat list of every title/body key the tour references — used by the
    // i18n parity test to assert each exists in both dictionaries.
    const TOUR_STEP_KEYS = TOUR_STEPS.reduce((a, s) => { a.push(s.titleKey, s.bodyKey); return a; }, []);

    // =========================================================
    // Section 1.2: Internationalization
    // =========================================================
    const LANG = {
        en: {
            // Dialog
            dialog_title: 'Export obj³',
            btn_export: 'Export',
            btn_close: 'Close',
            export_failed: 'Export failed: ',
            export_done: 'Done! {info}',
            status_building: 'Building…',
            status_baking: 'Baking frame {i}/{n}…',
            status_choose_location: '{info} — choose save location…',
            status_cancelled: 'Export cancelled',
            color_datapack_note: 'controlled by datapack settings',
            no_project: 'No project is open.',
            no_textures: 'The project has no textures.',
            // Texture section
            section_texture: 'Texture',
            atlas_combine: 'Combine textures into atlas',
            // Transform section
            section_transform: 'Transform',
            lbl_scale: 'Scale',
            lbl_offset_x: 'Offset X',
            lbl_offset_y: 'Offset Y',
            lbl_offset_z: 'Offset Z',
            // Behavior section (merged: transform + animation + color + advanced)
            section_behavior: 'Behavior',
            // Animation section
            section_animation: 'Animation',
            no_animations: 'No animations in project',
            lbl_animation: 'Animation',
            lbl_fps: 'FPS',
            lbl_start: 'Start (s)',
            lbl_end: 'End (s)',
            lbl_autoplay: 'Autoplay',
            lbl_duration: 'duration',
            // Datapack
            lbl_datapack: 'Control animation via datapack',
            datapack_info: 'In this mode R/G/B store the frame number (24-bit counter). Autoplay and duration are handled by the datapack.',
            lbl_anim_id: 'Animation ID',
            lbl_namespace: 'Namespace',
            lbl_target: 'Apply to',
            lbl_slot: 'Slot',
            lbl_respack_dir: 'Resource pack root',
            lbl_base_item: 'Base item',
            lbl_cmd_name: 'Custom model data name',
            lbl_export_equipment: 'Export as Equipment (armor)',
            lbl_equip_slot: 'Slot',
            lbl_equip_pieces: 'Armor pieces (whole set)',
            opt_piece_helmet: 'Helmet',
            opt_piece_chestplate: 'Chestplate',
            opt_piece_leggings: 'Leggings',
            opt_piece_boots: 'Boots',
            help_equip_pieces: 'Check the pieces to export as a full set; each writes its own armor asset. A face goes to the piece for its body part — tag groups via right-click "obj³: Body part", or name groups/elements head / body / right_arm / left_leg / right_foot etc. Leave all unchecked to use the single-part Slot below instead.',
            lbl_datapack_dir: 'Datapack output directory',
            tip_browse_folder: 'Choose folder',
            opt_equipment: 'Equipment entities',
            opt_item_display: 'Item display entity',
            opt_player: 'Player',
            opt_mainhand: 'Main hand',
            opt_offhand: 'Off hand',
            opt_head: 'Helmet',
            opt_chest: 'Chestplate',
            opt_legs: 'Leggings',
            opt_feet: 'Boots',
            opt_right_arm: 'Right arm',
            opt_left_arm: 'Left arm',
            opt_right_leg: 'Right leg',
            opt_left_leg: 'Left leg',
            opt_right_foot: 'Right foot',
            opt_left_foot: 'Left foot',
            placeholder_near_png: '(next to PNG)',
            player_note: 'For the player, a temporary armor stand is used (needed for custom_color changes).',
            datapack_funcs: 'Datapack functions: init, play, stop, set, play_from, play_once',
            // Display section
            section_display: 'Display',
            tip_bb_display: 'You can also use Blockbench\'s built-in display editor (it uses the same values)',
            tab_third: '3rd person R',
            tab_left: '3rd person L',
            tab_fpr: '1st person R',
            tab_fpl: '1st person L',
            tab_head: 'Head',
            tab_gui: 'Inventory',
            tab_ground: 'Ground',
            tab_fixed: 'Frame',
            tab_shelf: 'Shelf',
            lbl_rotation: 'Rotation',
            lbl_translation: 'Translation',
            lbl_display_scale: 'Scale',
            lbl_gui_pivot: 'GUI pivot',
            help_guiPivot: 'Rotation pivot for the inventory icon, in 1/16-block units. 0/0/0 = the block centre — the same pivot vanilla uses, so a rotated icon matches a vanilla model. Set a custom value to spin the icon about another point (e.g. your model\'s visual centre). Export-only; does not affect other slots.',
            columns_xyz: 'Columns are X, Y, Z.',
            ground_y_tip: 'Y is clamped by Minecraft engine — dropped items stick to the ground',
            preview_title: 'Preview',
            open_display_editor: 'Open in Blockbench Display editor',
            open_display_note: 'Pushes the current per-slot transforms into Blockbench, switches to its native Display editor on the active slot and closes this dialog. The dialog stays the source of truth for export.',
            open_display_disabled: 'Display mode is not available for this model format.',
            help_displayPreview: 'Opens Blockbench\'s own display editor with the dialog\'s current per-slot transforms applied, on the slot of the active tab. Edits made in Blockbench are not read back here; the dialog remains the source of truth for export.',
            // Color & Tinting
            section_color: 'Color & Tinting',
            cb_direct: 'Tint',
            cb_time: 'Time',
            cb_scale: 'Scale',
            cb_overlay: 'Overlay',
            cb_hurt: 'Hurt',
            color_all_direct: 'Model is tinted directly by potion color (custom_color)',
            color_all_time: 'All channels control animation time (24-bit frame)',
            color_all_scale: 'All channels control model scale',
            color_all_overlay: 'All channels act as HSV tint',
            color_all_hurt: 'All channels control hurt flash',
            // Advanced
            section_advanced: 'Advanced',
            lbl_easing: 'Easing',
            lbl_interpolation: 'Texture interpolation',
            lbl_autorotate: 'Autorotate',
            opt_none: 'None',
            opt_linear: 'Linear',
            opt_cubic: 'Cubic',
            opt_bezier: 'Bezier',
            opt_off: 'Off',
            opt_horizontal: 'Horizontal',
            opt_vertical: 'Vertical',
            opt_both: 'Both',
            lbl_noshadow: 'No shadow',
            lbl_flipuv: 'Flip UV',
            lbl_nopow: 'No power-of-two rounding',
            lbl_filter_armature: 'Hide armature bones',
            // Footer / status
            status_display_mode: 'Open File → Export obj³ when done',
            status_display_unavailable: 'Display mode is not available for this model format',
            // Validation
            err_fps_min: 'FPS must be at least 1',
            err_fps_max: 'FPS must be 60 or less',
            err_end_before_start: 'End time must be after start',
            err_need_anim_id: 'Animation ID is required',
            err_need_namespace: 'Namespace is required',
            err_atlas_none: 'Select at least one texture for atlas',
            // Preview warnings
            warn_model_empty: 'Model is empty — nothing to export',
            warn_too_many_faces: 'Too many faces ({n}). At 50K+ you may hit the UberGpuBuffer limit (2 MB) and crash the game.',
            warn_tex_wide: 'Texture wider than 512px ({w}px). On MC 1.21.11 such models may be invisible (obj³ issue #107).',
            warn_tex_narrow: 'Minimum texture width is 8px (currently {w}px). Export will fail.',
            warn_filter_no_armature: '"Hide armature bones" is enabled, but no armature in the project.',
            warn_atlas_empty: 'Atlas is enabled, but no textures are selected.',
            warn_tex_strip_ratio: 'Animated strip {w}x{h} is not a whole stack of square frames (height must be a multiple of width). Export will fail.',
            // Size units
            unit_b: 'B',
            unit_kb: 'KB',
            unit_mb: 'MB',
            // Outliner right-click menus
            menu_toggle_emissive: 'obj³: Toggle Emissive',
            menu_body_part: 'obj³: Body part',
            bp_none: '— None —',
            bp_head: 'Head',
            bp_body: 'Body / Chest',
            bp_arm_r: 'Right arm',
            bp_arm_l: 'Left arm',
            bp_leg_r: 'Right leg',
            bp_leg_l: 'Left leg',
            bp_foot_r: 'Right foot / boot',
            bp_foot_l: 'Left foot / boot',
            toast_emissive_on: 'Emissive: ON',
            toast_emissive_off: 'Emissive: OFF',
            toast_bodypart: 'obj³: {name} → {part}',
            undo_emissive_on: 'Enable emissive',
            undo_emissive_off: 'Disable emissive',
            undo_bodypart: 'Set obj³ body part',
            // Frame count
            frames_one: 'frame',
            frames_other: 'frames',
            ticks_one: 'tick',
            ticks_other: 'ticks',
            problems_one: 'problem',
            problems_other: 'problems',
            faces_one: 'face',
            faces_other: 'faces',
            warnings_one: 'warning',
            warnings_other: 'warnings',
            warn_suffix: ' ({n} {w} — see console)',
            // Help tooltips
            help_selectedTex: 'Texture applied to the model.',
            help_useAtlas: 'Combine multiple textures into one large PNG. Useful when the model has parts with different textures. One animated frame-strip texture per atlas is supported — it keeps animating, the rest stay static.',
            tex_anim_enable: 'Animate texture ({n} frames)',
            tex_frametime: 'Ticks per frame',
            tex_chip_each: 'each',
            tex_fade: 'Cross-fade frames',
            help_texAnim: 'Play the texture as a stack of frames. Best with a texture marked animated in Blockbench — just UV-map your model as usual (BB\'s UV grid already shows one frame). A plain vertical strip of square frames also works: frame count = height / width, UV onto the top frame. Works inside an atlas too (one animated strip per atlas).',
            help_texFrametime: 'How many game ticks (1/20 s) each texture frame is shown. 1 = fastest (20 fps).',
            help_texFade: 'Smoothly blend each frame into the next (like interpolate in vanilla .mcmeta). Works in hand, GUI and on equipment; some world views may hard-step.',
            help_scale: 'Size multiplier for the entire model. 1 = original, 2 = double. Note: final size is also multiplied by display slot scale.',
            help_offset: 'Shift all vertices in world coordinates (before encoding). Useful if the model is offset from center.',
            help_animationEnabled: 'Enable animation baking into texture. Without this, only the current pose is exported.',
            help_animationIndex: 'Which BlockBench animation to bake. One file = one animation.',
            help_animFps: 'How many animation frames per second to bake. Higher FPS = smoother but larger image. 20–30 is usually enough.',
            help_animRange: 'Which part of the animation to export (in seconds). Default = full length.',
            help_duration: 'How many game ticks (1/20 second) one animation cycle lasts. 0 = automatic (frame count).',
            help_autoplay: 'Animation plays by itself, syncing with GameTime. If disabled — control only via datapack.',
            help_generateDatapack: 'Create a datapack with play/stop/set/play_from/play_once commands for in-game animation control.',
            help_datapackAnimId: 'Short animation name (a-z, 0-9, _). Used in function paths.',
            help_datapackNamespace: 'Datapack namespace. Commands are run as "function <namespace>:<id>/play".',
            help_datapackTargetType: 'Who the animation applies to: equipment entity (zombie, skeleton), item_display entity, or player.',
            help_datapackEquipSlot: 'Which equipment slot is used for the model — hand/helmet/chestplate/leggings/boots.',
            help_respack_dir: 'Resource pack root folder. The plugin writes texture, models and the item override into assets/objc_cubed and assets/minecraft under it. Picked once.',
            help_base_item: 'Vanilla item the model overrides (e.g. iron_ingot). Multiple models on the same base item coexist via custom_model_data.',
            help_cmd_name: 'The string you put on the base item to show this model. The plugin writes a give command (<base item>_give.txt) with it. Default is the project name.',
            help_equipment: 'One equipment layer per model face. Renders the 3D model as worn armor via the entity shader. Reliable on the chest of a static armor stand; on moving players the anchor may tilt (work in progress).',
            help_datapackOutputDir: 'Where to save the datapack folder. Empty = next to resource pack.',
            help_useSeparateLefthand: 'By default, left hand copies right hand settings. Enable to configure separately.',
            lbl_separate_lefthand: 'Separate left hand',
            lbl_mirrors_right: 'Mirrors the third-person right hand.',
            help_display_third: 'Rotation and offset when visible in another player\'s hand (3rd person).',
            help_display_head: 'Rotation and offset when worn on head (player_head).',
            help_display_ground: 'Rotation and offset when on the ground (dropped).',
            help_display_fixed: 'Rotation and offset in item frame on wall.',
            help_cb_general: 'Each potion color channel (R/G/B) can be used as a switch: tint, animation time, scale, overlay, or hurt flash. Click to cycle.',
            help_easing: 'Smoothing between vertex animation frames. Linear = simple average. Cubic/Bezier = smoother at joints.',
            help_interpolation: 'Smoothing between texture frames. Linear gives a fade effect between frames.',
            help_autorotate: 'The shader derives the model rotation from quad normals, so it follows the render transform (item frames, entities). Yaw = horizontal only; Pitch = vertical only.',
            help_noshadow: 'Disable face darkening based on direction. Useful for glowing models.',
            help_flipuv: 'Flip texture vertically. Use if the model rendered upside down.',
            help_nopow: 'Don\'t round PNG height to power of two. Saves space but ancient GPUs may refuse to render.',
            help_filterArmature: 'Hide armature "bones" (diamond shapes) from export. Enable for Generic Model armature models.',
            // Guided tour (issue #4)
            tour_btn: 'Tour',
            tour_next: 'Next',
            tour_back: 'Back',
            tour_skip: 'Skip',
            tour_done: 'Done',
            tour_step: '{i} / {n}',
            tour_t_welcome: 'Welcome to obj³',
            tour_b_welcome: 'obj³ turns your BlockBench model into a Minecraft item with a real 3D look. It bakes the geometry and textures into a resource pack you can /give in-game. Use Next and Back to navigate, or Skip to leave.',
            tour_t_texture: 'Texture',
            tour_b_texture: 'Pick the texture that wraps the model. The thumbnail shows what is currently selected. This is the image baked into the exported item, so choose the one your model is actually painted with.',
            tour_t_atlas: 'Combine into atlas',
            tour_b_atlas: 'Only shown when the model uses several textures. Tick it to merge them into one atlas image so the export stays a single file; leave it off to pick just one texture from the list instead.',
            tour_t_texanim: 'Animated texture',
            tour_b_texanim: 'Appears when a texture is a stack of frames (marked animated in Blockbench, or height a whole multiple of width). Tick it to play the frames in game; set ticks per frame and optional cross-fade. Works inside an atlas too.',
            tour_t_display: 'Display slots',
            tour_b_display: 'These tabs are the contexts the item appears in: right/left hand in third and first person, head, GUI, ground, item frame, shelf. Each slot keeps its own position, rotation and scale; the left hand mirrors the right until you untick it on its tab.',
            tour_t_preview: 'Open in Blockbench',
            tour_b_preview: 'This button pushes the dialog\'s current per-slot transforms into Blockbench and opens its native Display editor on the active slot, so you can check the item against the real reference before you export. The dialog stays the source of truth.',
            tour_t_transform: 'Position, rotation, scale',
            tour_b_transform: 'For the selected slot, these three rows set rotation, translation and scale on each axis. Drag a field left/right or type a value; the preview updates live. Defaults usually need only small tweaks.',
            tour_t_animation: 'Animation',
            tour_b_animation: 'Tick this when your model has BlockBench animations and you want them baked into the texture. With it off, only the current static pose is exported. The controls below appear once it is enabled.',
            tour_t_animselect: 'Animation clip',
            tour_b_animselect: 'Choose which BlockBench animation to bake. Only one clip is exported per item, so if your model has several (idle, attack) pick the one you want here before exporting.',
            tour_t_fps: 'FPS',
            tour_b_fps: 'Frames per second sets the playback speed of the baked animation. Higher FPS is smoother but writes more frames into the texture. 20 matches one Minecraft tick per frame and is a safe default.',
            tour_t_range: 'Start / End',
            tour_b_range: 'These two fields trim the animation to a time range in seconds. Leave Start at 0 and End at the clip length to bake the whole thing, or narrow them to export just one segment.',
            tour_t_autoplay: 'Autoplay',
            tour_b_autoplay: 'Autoplay loops the animation forever on its own, which is great for idle effects. Turn it off if you would rather drive playback from commands; it is disabled while the datapack option is on.',
            tour_t_color: 'Color behaviors',
            tour_b_color: 'Each potion color channel (R, G, B) can drive a behavior: tint recolors the model, time advances the animation, scale resizes it, overlay blends a layer, hurt flashes red. Click a channel to cycle its mode.',
            tour_t_datapack: 'Datapack control',
            tour_b_datapack: 'Tick this to generate a datapack so commands can drive the item: play, stop, play_from a frame, or play_once. It replaces autoplay with full command control. The fields below configure it.',
            tour_t_datapackid: 'Datapack id & namespace',
            tour_b_datapackid: 'The animation id and namespace name the generated functions, for example namespace:id/play. Keep them short and unique so they do not clash with other datapacks already loaded on the world.',
            tour_t_datapacktarget: 'Datapack target & slot',
            tour_b_datapacktarget: 'Target picks what the animation applies to: an equipped item, an item_display entity, or the player. For equipment and player you also choose the slot (mainhand, head, chest and so on).',
            tour_t_equipment: 'Equipment / armor',
            tour_b_equipment: 'Tick this to export as wearable armor instead of a held item. The model renders on the player or an armor stand. The slot selector appears below once this is enabled.',
            tour_t_equipslot: 'Equipment slot',
            tour_b_equipslot: 'Choose which armor slot the model occupies: head, chest, legs or feet. This only matters for equipment export and decides where the model shows up when worn.',
            tour_t_respack: 'Resource-pack folder',
            tour_b_respack: 'Choose one resource-pack root folder; obj³ writes everything under the objc_cubed namespace inside it. Use the folder button to browse. This is where the finished pack lands.',
            tour_t_baseitem: 'Base item',
            tour_b_baseitem: 'The vanilla item your model rides on top of, such as iron_ingot. The /give command uses this item, and your model replaces its appearance. Any item works; pick one you will not confuse with the real thing.',
            tour_t_cmdname: 'Model name',
            tour_b_cmdname: 'A short identifier for this model used as its custom_model_data name. obj³ shows it after export so you can /give the base item with this name and spawn your model in-game.',
            tour_t_easing: 'Easing',
            tour_b_easing: 'Easing shapes how motion accelerates between frames so the animation looks less mechanical. None keeps frames raw; linear, cubic and bezier add progressively smoother transitions. Leave at default if unsure.',
            tour_t_interpolation: 'Texture interpolation',
            tour_b_interpolation: 'Blends between the frames of an animated TEXTURE (a frame strip), not the geometry. Off shows each texture frame sharply; linear cross-fades between them. Only matters when the texture itself is animated.',
            tour_t_autorotate: 'Autorotate',
            tour_b_autorotate: 'Autorotate makes the model follow its render transform — turning to face the right way in item frames, on entities or in world slots, instead of staying fixed. Off keeps it fixed; horizontal, vertical or both choose which axes track. Handy for framed or worn items.',
            tour_t_flags: 'Advanced flags',
            tour_b_flags: 'No shadow hides the drop shadow, flip UV mirrors texture mapping if your faces look reversed, and no power-of-two skips padding the atlas to a power-of-two size. Leave them off unless you hit a specific issue.',
            tour_t_export: 'Export',
            tour_b_export: 'When everything looks right, hit Export to write the model, texture and overrides into the pack. obj³ tells you the custom_model_data name to /give. Replay this tour any time via the ? button.',
        },
        ru: {
            dialog_title: 'Экспорт obj³',
            btn_export: 'Экспортировать',
            btn_close: 'Закрыть',
            export_failed: 'Экспорт не удался: ',
            export_done: 'Готово! {info}',
            status_building: 'Построение…',
            status_baking: 'Запекаю кадр {i}/{n}…',
            status_choose_location: '{info} — выберите место сохранения…',
            status_cancelled: 'Экспорт отменён',
            color_datapack_note: 'управляется настройками датапака',
            no_project: 'Нет открытого проекта.',
            no_textures: 'В проекте нет текстур.',
            section_texture: 'Текстура',
            atlas_combine: 'Объединить текстуры в атлас',
            section_transform: 'Трансформация',
            lbl_scale: 'Масштаб',
            lbl_offset_x: 'Сдвиг X',
            lbl_offset_y: 'Сдвиг Y',
            lbl_offset_z: 'Сдвиг Z',
            section_behavior: 'Поведение',
            section_animation: 'Анимация',
            no_animations: 'В проекте нет анимаций',
            lbl_animation: 'Анимация',
            lbl_fps: 'FPS',
            lbl_start: 'Старт (с)',
            lbl_end: 'Конец (с)',
            lbl_autoplay: 'Автозапуск',
            lbl_duration: 'длительность',
            lbl_datapack: 'Управлять анимацией через датапак',
            datapack_info: 'В этом режиме R/G/B хранят номер кадра (24-битный счётчик). Автозапуском и длительностью занимается датапак.',
            lbl_anim_id: 'ID анимации',
            lbl_namespace: 'Пространство имён',
            lbl_target: 'Кому применять',
            lbl_slot: 'Слот',
            lbl_respack_dir: 'Корень ресурспака',
            lbl_base_item: 'Базовый предмет',
            lbl_cmd_name: 'Имя custom_model_data',
            lbl_export_equipment: 'Экспорт как экипировка (броня)',
            lbl_equip_slot: 'Слот',
            lbl_equip_pieces: 'Части брони (набор)',
            opt_piece_helmet: 'Шлем',
            opt_piece_chestplate: 'Нагрудник',
            opt_piece_leggings: 'Поножи',
            opt_piece_boots: 'Ботинки',
            help_equip_pieces: 'Отметьте части брони для экспорта набором; каждая пишет свой ассет. Грань уходит в ту часть тела, к которой относится — тег группы через ПКМ «obj³: Body part» либо имя группы/элемента head / body / right_arm / left_leg / right_foot и т.д. Если ничего не отмечено — используется одиночный Слот ниже.',
            lbl_datapack_dir: 'Куда сохранить датапак',
            tip_browse_folder: 'Выбрать папку',
            opt_equipment: 'Сущности с экипировкой',
            opt_item_display: 'Сущность item_display',
            opt_player: 'Игроку',
            opt_mainhand: 'Главная рука',
            opt_offhand: 'Вторая рука',
            opt_head: 'Шлем',
            opt_chest: 'Нагрудник',
            opt_legs: 'Поножи',
            opt_feet: 'Ботинки',
            opt_right_arm: 'Правая рука',
            opt_left_arm: 'Левая рука',
            opt_right_leg: 'Правая нога',
            opt_left_leg: 'Левая нога',
            opt_right_foot: 'Правая ступня',
            opt_left_foot: 'Левая ступня',
            placeholder_near_png: '(рядом с PNG)',
            player_note: 'Для игрока используется временный armor stand (нужен для смены custom_color).',
            datapack_funcs: 'Функции датапака: init, play, stop, set, play_from, play_once',
            section_display: 'Отображение',
            tip_bb_display: 'Также можно использовать встроенный редактор отображения Blockbench (он работает с теми же значениями)',
            tab_third: '3-е лицо ⮕',
            tab_left: '3-е лицо ⬅',
            tab_fpr: '1-е лицо ⮕',
            tab_fpl: '1-е лицо ⬅',
            tab_head: 'Голова',
            tab_gui: 'Инвентарь',
            tab_ground: 'Земля',
            tab_fixed: 'Рамка',
            tab_shelf: 'Полка',
            lbl_rotation: 'Поворот',
            lbl_translation: 'Сдвиг',
            lbl_display_scale: 'Масштаб',
            lbl_gui_pivot: 'GUI пивот',
            help_guiPivot: 'Точка вращения иконки в инвентаре, в 1/16 блока. 0/0/0 = центр блока — тот же pivot, что у ванили, так что повёрнутая иконка совпадает с ванильной моделью. Задайте своё значение, чтобы вращать иконку вокруг другой точки (например, визуального центра модели). Только для экспорта; другие слоты не трогает.',
            columns_xyz: 'Колонки — X, Y, Z.',
            ground_y_tip: 'Y ограничивается движком Minecraft — выброшенные предметы прилипают к земле',
            preview_title: 'Превью',
            open_display_editor: 'Открыть в редакторе отображения Blockbench',
            open_display_note: 'Записывает текущие трансформы слотов в Blockbench, переключает в его родной редактор отображения на активном слоте и закрывает это окно. Источник истины для экспорта остаётся это окно.',
            open_display_disabled: 'Режим отображения недоступен в этом формате модели.',
            help_displayPreview: 'Открывает родной редактор отображения Blockbench с текущими трансформами слотов из этого окна, на слоте активной вкладки. Правки в Blockbench не читаются обратно сюда; источник истины для экспорта остаётся это окно.',
            section_color: 'Цвет и подсветка',
            cb_direct: 'Тинт',
            cb_time: 'Время',
            cb_scale: 'Масштаб',
            cb_overlay: 'Оттенок',
            cb_hurt: 'Урон',
            color_all_direct: 'Модель тинтуется напрямую цветом зелья (custom_color)',
            color_all_time: 'Весь цвет управляет временем анимации (24-битный кадр)',
            color_all_scale: 'Весь цвет управляет масштабом модели',
            color_all_overlay: 'Весь цвет работает как HSV-оттенок',
            color_all_hurt: 'Весь цвет управляет красной вспышкой «получил урон»',
            section_advanced: 'Дополнительно',
            lbl_easing: 'Плавность',
            lbl_interpolation: 'Интерполяция текстур',
            lbl_autorotate: 'Автоповорот',
            opt_none: 'Нет',
            opt_linear: 'Линейная',
            opt_cubic: 'Кубическая',
            opt_bezier: 'Безье',
            opt_off: 'Выкл',
            opt_horizontal: 'По горизонтали',
            opt_vertical: 'По вертикали',
            opt_both: 'Оба',
            lbl_noshadow: 'Без тени',
            lbl_flipuv: 'Перевернуть UV',
            lbl_nopow: 'Без округления до степени 2',
            lbl_filter_armature: 'Скрыть кости арматуры',
            status_display_mode: 'Откройте File → Экспорт obj³ когда закончите',
            status_display_unavailable: 'Режим отображения недоступен в этом формате модели',
            err_fps_min: 'FPS должен быть не меньше 1',
            err_fps_max: 'FPS должен быть не больше 60',
            err_end_before_start: 'Время Конец должно быть больше Старт',
            err_need_anim_id: 'Нужен Animation ID',
            err_need_namespace: 'Нужен Namespace',
            err_atlas_none: 'Выберите хотя бы одну текстуру для атласа',
            warn_model_empty: 'Модель пуста — нечего экспортировать',
            warn_too_many_faces: 'Очень много граней ({n}). На 50K+ можно упереться в лимит UberGpuBuffer (2 МБ) и крашнуть игру.',
            warn_tex_wide: 'Текстура шире 512px ({w}px). На MC 1.21.11 такие модели могут быть невидимыми (obj³ issue #107).',
            warn_tex_narrow: 'Минимальная ширина текстуры — 8px (сейчас {w}px). Экспорт упадёт.',
            warn_filter_no_armature: '«Скрыть кости арматуры» включено, но в проекте нет арматуры.',
            warn_atlas_empty: 'Атлас включён, но не выбрана ни одна текстура.',
            warn_tex_strip_ratio: 'Анимационная полоса {w}x{h} не является целым набором квадратных кадров (высота должна быть кратна ширине). Экспорт не удастся.',
            unit_b: 'Б',
            unit_kb: 'КБ',
            unit_mb: 'МБ',
            // Outliner right-click menus
            menu_toggle_emissive: 'obj³: Переключить свечение',
            menu_body_part: 'obj³: Часть тела',
            bp_none: '— Нет —',
            bp_head: 'Голова',
            bp_body: 'Тело / Грудь',
            bp_arm_r: 'Правая рука',
            bp_arm_l: 'Левая рука',
            bp_leg_r: 'Правая нога',
            bp_leg_l: 'Левая нога',
            bp_foot_r: 'Правая ступня / ботинок',
            bp_foot_l: 'Левая ступня / ботинок',
            toast_emissive_on: 'Свечение: ВКЛ',
            toast_emissive_off: 'Свечение: ВЫКЛ',
            toast_bodypart: 'obj³: {name} → {part}',
            undo_emissive_on: 'Включить свечение',
            undo_emissive_off: 'Выключить свечение',
            undo_bodypart: 'Задать часть тела obj³',
            frames_one: 'кадр',
            frames_few: 'кадра',
            frames_many: 'кадров',
            ticks_one: 'тик',
            ticks_few: 'тика',
            ticks_many: 'тиков',
            problems_one: 'проблема',
            problems_few: 'проблемы',
            problems_many: 'проблем',
            faces_one: 'грань',
            faces_few: 'грани',
            faces_many: 'граней',
            warnings_one: 'предупреждение',
            warnings_few: 'предупреждения',
            warnings_many: 'предупреждений',
            warn_suffix: ' ({n} {w} — см. консоль)',
            help_selectedTex: 'Текстура которая накладывается на модель.',
            help_useAtlas: 'Объединить несколько текстур в один большой PNG. Полезно когда модель состоит из частей с разными текстурами. Поддерживается одна анимированная текстура-полоса на атлас — она продолжает анимироваться, остальные статичны.',
            tex_anim_enable: 'Анимировать текстуру ({n} кадров)',
            tex_frametime: 'Тиков на кадр',
            tex_chip_each: 'каждый',
            tex_fade: 'Плавный переход кадров',
            help_texAnim: 'Проигрывать текстуру как стопку кадров. Лучше всего — текстура, помеченная анимированной в самом Blockbench: просто разверните модель как обычно (UV-сетка BB уже показывает один кадр). Обычная вертикальная полоса квадратных кадров тоже работает: число кадров = высота / ширина, UV на верхний кадр. Работает и внутри атласа (одна анимированная полоса на атлас).',
            help_texFrametime: 'Сколько игровых тиков (1/20 с) показывается каждый кадр текстуры. 1 = максимально быстро (20 кадров/с).',
            help_texFade: 'Плавно смешивать кадры между собой (как interpolate в ванильной .mcmeta). Работает в руке, GUI и на экипировке; в некоторых мировых видах кадры могут переключаться резко.',
            help_scale: 'Множитель размера всей модели. 1 = исходный, 2 = вдвое больше. Внимание: финальный размер ещё умножается на масштаб слота отображения.',
            help_offset: 'Сдвиг всех вершин в мировых координатах (до кодирования). Полезно если модель смещена от центра.',
            help_animationEnabled: 'Включить запись анимации в текстуру. Без этого экспортируется только одна (текущая) поза.',
            help_animationIndex: 'Какую BlockBench-анимацию запекать. В одном файле — одна анимация.',
            help_animFps: 'Сколько кадров анимации в секунду запекать. Больше FPS = плавнее но картинка крупнее. 20–30 обычно хватает.',
            help_animRange: 'Какой кусок анимации экспортировать (в секундах). По умолчанию — вся длина.',
            help_duration: 'Сколько игровых тиков (1/20 секунды) длится один цикл анимации. 0 = автоматически (длина в кадрах).',
            help_autoplay: 'Анимация играет сама по себе, синхронизируясь с GameTime. Если выключить — управление только через датапак.',
            help_generateDatapack: 'Создать датапак с командами play/stop/set/play_from/play_once для управления анимацией прямо в игре.',
            help_datapackAnimId: 'Короткое имя анимации (a-z, 0-9, _). Будет использовано в путях функций.',
            help_datapackNamespace: 'Namespace датапака. Команды вызываются как «function <namespace>:<id>/play».',
            help_datapackTargetType: 'Кому применяется анимация: сущности с экипировкой (зомби, скелет), сущность item_display, или игроку.',
            help_datapackEquipSlot: 'Какой слот экипировки используется для модели — рука/шлем/нагрудник/поножи/ботинки.',
            help_respack_dir: 'Корневая папка ресурспака. Плагин кладёт текстуру, модели и override предмета в assets/objc_cubed и assets/minecraft внутри неё. Выбирается один раз.',
            help_base_item: 'Ванильный предмет, который заменяется моделью (например iron_ingot). Несколько моделей на одном предмете сосуществуют через custom_model_data.',
            help_cmd_name: 'Строка, которую вы вешаете на базовый предмет, чтобы показать эту модель. Плагин пишет команду give (<базовый предмет>_give.txt) с ней. По умолчанию — имя проекта.',
            help_equipment: 'Один слой экипировки на каждую грань модели. Рендерит 3D-модель как надетую броню через шейдер сущности. Надёжно работает на нагруднике статичного armor stand; на движущихся игроках якорь может наклоняться (в разработке).',
            help_datapackOutputDir: 'Куда положить папку датапака. Пусто = рядом с ресурспаком.',
            help_useSeparateLefthand: 'По умолчанию левая рука копирует настройки правой. Включите, если хотите настроить её отдельно.',
            lbl_separate_lefthand: 'Отдельная левая рука',
            lbl_mirrors_right: 'Зеркалит правую руку от третьего лица.',
            help_display_third: 'Поворот и сдвиг модели когда она видна в руке другого игрока (от 3-го лица).',
            help_display_head: 'Поворот и сдвиг модели когда она надета на голову (player_head).',
            help_display_ground: 'Поворот и сдвиг модели когда она лежит на земле (выпавшая).',
            help_display_fixed: 'Поворот и сдвиг модели в item frame на стене.',
            help_cb_general: 'Каждый канал цвета зелья (R/G/B) можно использовать как переключатель: тинт, время анимации, масштаб, оттенок или вспышка урона. Клик меняет значение.',
            help_easing: 'Сглаживание между кадрами анимации вершин. Линейная — обычное усреднение. Кубическая/Безье — плавнее на стыках.',
            help_interpolation: 'Сглаживание между кадрами текстуры. Линейная даёт плавное затухание между кадрами.',
            help_autorotate: 'Шейдер определяет поворот модели по нормалям, поэтому она следует за рендер-трансформом (рамки, сущности). Yaw = только горизонтальный; Pitch = только вертикальный.',
            help_noshadow: 'Отключить затемнение граней по их направлению. Полезно для светящихся моделей.',
            help_flipuv: 'Перевернуть текстуру по вертикали. Используйте, если модель отрендерилась перевёрнутой.',
            help_nopow: 'Не округлять высоту PNG до степени двойки. Экономит место, но древние GPU могут отказаться рендерить.',
            help_filterArmature: 'Скрыть «кости» (диамантики арматуры) из экспорта. Включайте для моделей с арматурой Generic Model.',
            // Гид по интерфейсу (issue #4)
            tour_btn: 'Тур',
            tour_next: 'Далее',
            tour_back: 'Назад',
            tour_skip: 'Пропустить',
            tour_done: 'Готово',
            tour_step: '{i} / {n}',
            tour_t_welcome: 'Добро пожаловать в obj³',
            tour_b_welcome: 'obj³ превращает модель BlockBench в предмет Minecraft с настоящим объёмным видом. Геометрия и текстуры запекаются в ресурспак, который выдаётся командой /give. Листайте кнопками Далее и Назад, Пропустить закрывает обучение.',
            tour_t_texture: 'Текстура',
            tour_b_texture: 'Выберите текстуру, которая оборачивает модель. Миниатюра показывает, что выбрано сейчас. Именно это изображение запекается в экспортируемый предмет, так что берите ту текстуру, которой реально раскрашена модель.',
            tour_t_atlas: 'Объединить в атлас',
            tour_b_atlas: 'Показывается только когда у модели несколько текстур. Включите, чтобы слить их в один атлас и оставить экспорт одним файлом; выключите, чтобы выбрать из списка только одну текстуру.',
            tour_t_texanim: 'Анимированная текстура',
            tour_b_texanim: 'Появляется, когда текстура — стопка кадров (помечена анимированной в Blockbench или высота кратна ширине). Включите, чтобы кадры проигрывались в игре; задайте тики на кадр и, по желанию, плавное смешивание. Работает и внутри атласа.',
            tour_t_display: 'Слоты отображения',
            tour_b_display: 'Эти вкладки — контексты, в которых виден предмет: правая/левая рука от третьего и первого лица, голова, инвентарь (GUI), земля, рамка, полка. У каждого слота своя позиция, поворот и масштаб; левая рука зеркалит правую, пока не снимете галку на её вкладке.',
            tour_t_preview: 'Открыть в Blockbench',
            tour_b_preview: 'Эта кнопка записывает текущие трансформы слотов из окна в Blockbench и открывает его родной редактор отображения на активном слоте, чтобы проверить предмет на реальном референсе до экспорта. Источник истины остаётся это окно.',
            tour_t_transform: 'Позиция, поворот, масштаб',
            tour_b_transform: 'Для выбранного слота эти три строки задают поворот, смещение и масштаб по каждой оси. Тяните поле влево/вправо или вводите значение — превью обновляется сразу. Обычно хватает небольших правок от значений по умолчанию.',
            tour_t_animation: 'Анимация',
            tour_b_animation: 'Включите, если у модели есть BlockBench-анимации и вы хотите запечь их в текстуру. Без этого экспортируется только текущая статичная поза. Элементы ниже появляются после включения.',
            tour_t_animselect: 'Клип анимации',
            tour_b_animselect: 'Выберите, какую BlockBench-анимацию запекать. На предмет экспортируется только один клип, поэтому если анимаций несколько (idle, attack), выберите нужную здесь до экспорта.',
            tour_t_fps: 'FPS',
            tour_b_fps: 'Кадры в секунду задают скорость воспроизведения запечённой анимации. Больше FPS — плавнее, но в текстуру пишется больше кадров. 20 соответствует одному тику Minecraft на кадр и безопасно по умолчанию.',
            tour_t_range: 'Старт / Конец',
            tour_b_range: 'Эти два поля обрезают анимацию по диапазону времени в секундах. Оставьте «Старт» на 0 и «Конец» на длине клипа, чтобы запечь всё, либо сузьте их, чтобы экспортировать только один отрезок.',
            tour_t_autoplay: 'Автозапуск',
            tour_b_autoplay: 'Автозапуск зацикливает анимацию сам по себе — удобно для постоянных эффектов. Выключите, если хотите управлять воспроизведением командами; он недоступен, пока включён режим датапака.',
            tour_t_color: 'Поведение цвета',
            tour_b_color: 'Каждый канал цвета зелья (R, G, B) может задавать поведение: тинт перекрашивает модель, время прокручивает анимацию, масштаб меняет размер, оттенок подмешивает слой, урон мигает красным. Клик по каналу переключает режим.',
            tour_t_datapack: 'Управление датапаком',
            tour_b_datapack: 'Включите, чтобы сгенерировать датапак и управлять предметом командами: play, stop, play_from (с кадра), play_once. Он заменяет автозапуск полным управлением через команды. Поля ниже его настраивают.',
            tour_t_datapackid: 'Id и namespace датапака',
            tour_b_datapackid: 'Id анимации и namespace задают имена сгенерированных функций, например namespace:id/play. Делайте их короткими и уникальными, чтобы не пересекаться с другими датапаками, уже загруженными в мире.',
            tour_t_datapacktarget: 'Цель и слот датапака',
            tour_b_datapacktarget: 'Цель определяет, к чему применяется анимация: к надетому предмету, к сущности item_display или к игроку. Для экипировки и игрока также выбирается слот («Главная рука», «Шлем», «Нагрудник» и т.д.).',
            tour_t_equipment: 'Экипировка / броня',
            tour_b_equipment: 'Включите, чтобы экспортировать как носимую броню, а не предмет в руке. Модель рендерится на игроке или на стойке для брони. Выбор слота появляется ниже после включения.',
            tour_t_equipslot: 'Слот экипировки',
            tour_b_equipslot: 'Выберите, какой слот брони занимает модель: голова, грудь, ноги или ступни. Это важно только для экспорта экипировки и решает, где модель появится при надевании.',
            tour_t_respack: 'Папка ресурспака',
            tour_b_respack: 'Выберите одну корневую папку ресурспака; obj³ пишет всё в namespace objc_cubed внутри неё. Кнопка папки открывает обзор. Именно сюда ляжет готовый пак.',
            tour_t_baseitem: 'Базовый предмет',
            tour_b_baseitem: 'Ванильный предмет, на котором держится модель, например iron_ingot. Команда /give использует его, а модель заменяет его вид. Подойдёт любой предмет; берите тот, что не спутаете с настоящим.',
            tour_t_cmdname: 'Имя модели',
            tour_b_cmdname: 'Короткий идентификатор модели, используемый как имя custom_model_data. obj³ показывает его после экспорта, чтобы вы выдали базовый предмет через /give с этим именем и заспавнили модель в игре.',
            tour_t_easing: 'Плавность',
            tour_b_easing: 'Плавность задаёт, как движение ускоряется между кадрами, чтобы анимация выглядела менее механически. «Нет» оставляет кадры как есть; «Линейная», «Кубическая» и «Безье» добавляют всё более плавные переходы. Если не уверены — оставьте по умолчанию.',
            tour_t_interpolation: 'Интерполяция текстур',
            tour_b_interpolation: 'Смешивает кадры анимированной ТЕКСТУРЫ (полоски кадров), а не геометрию. «Выкл» переключает кадры текстуры резко; «Линейная» плавно смешивает их между собой. Важно только когда анимирована сама текстура.',
            tour_t_autorotate: 'Автоповорот',
            tour_b_autorotate: 'Автоповорот заставляет модель следовать своему рендер-трансформу — поворачиваться как надо в рамках, на сущностях и в мировых слотах, а не оставаться статичной. «Выкл» оставляет её неподвижной; «По горизонтали», «По вертикали» или «Оба» задают оси. Удобно для предметов в рамке или надетых.',
            tour_t_flags: 'Доп. флаги',
            tour_b_flags: '«Без тени» убирает тень, «Перевернуть UV» зеркалит развёртку, если грани выглядят перевёрнутыми, а «Без округления до степени 2» отключает дополнение атласа до степени двойки. Оставьте выключенными, пока не столкнётесь с конкретной проблемой.',
            tour_t_export: 'Экспорт',
            tour_b_export: 'Когда всё готово, нажмите Экспорт — модель, текстура и override запишутся в пак. obj³ покажет имя custom_model_data для /give. Повторить тур можно кнопкой ? в любой момент.',
        }
    };

    function t(key) {
        const lang = (typeof settings !== 'undefined' && settings.language) ? settings.language.value : 'en';
        return (LANG[lang] && LANG[lang][key]) || LANG.en[key] || key;
    }

    /**
     * Language-aware plural helper. Picks the correct grammatical form for `n`
     * in the active language and looks it up as `key + '_' + form`:
     *   - EN: standard one/other  → keys X_one / X_other
     *   - RU: standard Slavic rule → keys X_one / X_few / X_many
     *       one  : n%10==1 && n%100!=11      (1, 21, 31 … кадр)
     *       few  : n%10 in 2..4 && n%100 not in 12..14  (2-4, 22-24 … кадра)
     *       many : everything else           (0, 5-20, 25-30 … кадров)
     * Falls back gracefully so a missing form never crashes: try the chosen
     * form, then '_other', then '_one', then the bare key.
     */
    function pluralForm(n, lang) {
        if (lang === 'ru') {
            const mod10 = n % 10, mod100 = n % 100;
            if (mod10 === 1 && mod100 !== 11) return 'one';
            if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
            return 'many';
        }
        return (n === 1) ? 'one' : 'other';
    }
    function tPlural(n, key) {
        const lang = (typeof settings !== 'undefined' && settings.language) ? settings.language.value : 'en';
        const form = pluralForm(n, lang);
        const dict = (LANG[lang] && LANG[lang][key + '_' + form] != null) ? LANG[lang] : LANG.en;
        // Resolve against the chosen dict with graceful fallback to other shapes.
        const pick = (suf) => dict[key + suf];
        const val = pick('_' + form) || pick('_other') || pick('_one') || pick('') || (key + '_' + form);
        return val;
    }

    // Surface a warning to the USER (not just the dev console). Many export
    // problems used to only console.warn, so users saw "Done!" while geometry
    // was silently missing. Routes through Blockbench's toast when available;
    // falls back to console only (headless/tests). Pass a ready string.
    function surfaceWarning(msg) {
        console.warn('[obj³] ' + msg);
        try {
            if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                Blockbench.showQuickMessage('obj³: ' + msg, 4500);
            }
        } catch (e) { /* no Blockbench (tests/headless) — console is enough */ }
    }

    // (BBPlugin.register lives at the very END of the IIFE so that every
    // helper and module-level let/const it touches via onload/onunload
    // — installProjectPersistence, _compileHandler, installStylesheet,
    // STYLESHEET_ID, etc. — has been declared and initialized by the time
    // Blockbench synchronously fires those lifecycle callbacks during the
    // plugin reload.)

    // =========================================================
    // Section 1.3: Plugin Stylesheet (injected once on load)
    // =========================================================
    // Classes used inside the dialog template. Keeping styles centralized
    // here lets Stage 7 (polish) extend them without touching the template.
    const STYLESHEET_ID = 'objcubed-styles';
    const STYLESHEET = `
        /* BlockBench's own stylesheet gives form controls a non-zero
           min-width that pushes ranges/selects past their grid cells.
           We override with !important to win the specificity war. */
        .oc-root, .oc-root * { box-sizing: border-box; }
        .oc-root {
            font-family: 'Noto Sans', sans-serif; font-weight: 400;
            --oc-scale: 1.25;
            --oc-fs: calc(14px * var(--oc-scale));
            font-size: var(--oc-fs);
        }
        .oc-root h2, .oc-root h3,
        .oc-root button, .oc-root .oc-section-head { font-family: 'Motiva Sans', 'Noto Sans', sans-serif; }
        .oc-root .material-icons { font-family: 'Material Icons' !important; font-weight: normal !important; }

        .oc-root input,
        .oc-root select,
        .oc-root textarea,
        .oc-root button {
            min-width: 0 !important;
            font-family: inherit;
        }
        .oc-root input[type=range] {
            min-width: 0 !important;
            width: 100% !important;
            accent-color: #5a8cc0;
        }
        .oc-root input[type=checkbox] { accent-color: #5a8cc0; }
        .oc-root input[type=number],
        .oc-root input[type=text],
        .oc-root input:not([type]) { width: 100%; }

        /* Focus rings — replace ugly browser default with a plugin-toned ring */
        .oc-root input:focus-visible,
        .oc-root select:focus-visible,
        .oc-root textarea:focus-visible,
        .oc-root button:focus-visible {
            outline: 2px solid #5a8cc0;
            outline-offset: 1px;
        }

        /* Inline error message under a field — same style as AnimatedJava */
        .oc-err-msg {
            display: flex; align-items: center; gap: 4px;
            color: #f88; font-size: calc(11px * var(--oc-scale));
            margin-top: 2px;
            line-height: 1.3;
        }
        .oc-err-msg::before {
            content: '!';
            display: inline-block;
            width: 12px; height: 12px;
            border-radius: 50%;
            background: #c44; color: #fff;
            font-weight: 700; font-size: calc(9px * var(--oc-scale));
            text-align: center; line-height: 12px;
            flex-shrink: 0;
        }

        /* Long monospace strings (datapack command sample) — wrap aggressively */
        .oc-mono-wrap { word-break: break-all; font-family: monospace; }

        .oc-help {
            position: relative;
            display:inline-block; width:calc(14px * var(--oc-scale)); height:calc(14px * var(--oc-scale));
            margin-left:4px; vertical-align:middle;
            border-radius:50%;
            background:#3a3a3a; color:#ccc;
            font-size:calc(10px * var(--oc-scale)); font-weight:700; font-family:sans-serif;
            text-align:center; line-height:calc(14px * var(--oc-scale));
            cursor:help; user-select:none;
            transition:background 120ms, color 120ms;
            flex-shrink: 0;
        }
        .oc-help:hover { background:#5a8cc0; color:#fff; }

        /* JS-driven tooltip portal — slides in from above with a soft drop. */
        .oc-tooltip {
            position: fixed;
            background: #1a1a1a;
            color: #e6e6e6;
            padding: 6px 9px;
            border: none;
            border-radius: 4px;
            font-size: calc(11px * var(--oc-scale));
            font-weight: 400;
            line-height: 1.4;
            max-width: 280px;
            z-index: 99999;
            pointer-events: none;
            box-shadow: 0 4px 16px rgba(0,0,0,0.6);
            opacity: 0;
            transform: translateY(-4px);
            transition: opacity 140ms ease-out, transform 140ms ease-out;
        }
        .oc-tooltip.visible { opacity: 1; transform: translateY(0); }

        .oc-err {
            outline: 1.5px solid #c44 !important;
            outline-offset: 1px;
            background: rgba(204,68,68,0.07) !important;
        }
        .oc-err-badge {
            display:inline-flex; align-items:center; gap:3px;
            padding:3px 9px; border-radius:11px;
            background:rgba(204,68,68,0.18); color:#f99;
            border:none;
            font-size:calc(12px * var(--oc-scale)); font-weight:600;
            cursor:help; user-select:none;
        }

        /* Section card */
        .oc-section {
            margin-bottom: 12px;
            border: none;
            border-radius: 4px;
            background: rgba(255,255,255,0.025);
        }
        .oc-section-head {
            padding: calc(8px * var(--oc-scale)) calc(10px * var(--oc-scale));
            display: flex; align-items: center; gap: 8px;
            font-weight: 600; color: #ddd;
            user-select: none;
        }
        .oc-section-head.clickable { cursor: pointer; transition: background 120ms; }
        .oc-section-head.clickable:hover { background: rgba(255,255,255,0.04); }
        .oc-section-head .material-icons {
            font-size: calc(18px * var(--oc-scale));
            color: #5a8cc0;
            opacity: 0.85;
        }
        .oc-section-body { padding: 0 calc(12px * var(--oc-scale)) calc(10px * var(--oc-scale)) calc(12px * var(--oc-scale)); }

        /* Inline buttons — borderless, BB-native style */
        .oc-btn {
            padding: calc(4px * var(--oc-scale)) calc(8px * var(--oc-scale)); cursor: pointer;
            background: rgba(255,255,255,0.06); border: none;
            color: #bbb; border-radius: 4px;
            transition: background 100ms, color 100ms;
            font-family: inherit; font-size: calc(12px * var(--oc-scale));
            min-width: 0; min-height: 0;
            line-height: 1.2;
        }
        .oc-btn:hover:not(:disabled) {
            background: rgba(255,255,255,0.12); color: #fff;
        }
        .oc-btn:active:not(:disabled) { background: rgba(255,255,255,0.04); }
        .oc-btn:disabled { color: #555; cursor: not-allowed; opacity: 0.55; }
        .oc-btn-danger:hover:not(:disabled) {
            background: rgba(204,68,68,0.2); color: #fdd;
        }
        .oc-btn-primary {
            background: rgba(90,140,192,0.15); color: #9bc;
        }
        .oc-btn-primary:hover:not(:disabled) {
            background: rgba(90,140,192,0.25); color: #fff;
        }

        /* Icon-only square buttons — defensive against BB defaults.
           Force a square outer box AND clip the glyph so the icon font's
           intrinsic width can't bulge the button horizontally. */
        .oc-root .oc-icon-btn {
            width: calc(24px * var(--oc-scale)) !important;
            min-width: calc(24px * var(--oc-scale)) !important;
            max-width: calc(24px * var(--oc-scale)) !important;
            height: calc(24px * var(--oc-scale)) !important;
            min-height: calc(24px * var(--oc-scale)) !important;
            max-height: calc(24px * var(--oc-scale)) !important;
            padding: 0 !important;
            margin: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important;
            box-sizing: border-box !important;
            line-height: 1 !important;
            overflow: hidden !important;
        }
        .oc-root .oc-icon-btn .material-icons {
            font-size: calc(14px * var(--oc-scale)) !important;
            width: calc(14px * var(--oc-scale)) !important;
            height: calc(14px * var(--oc-scale)) !important;
            line-height: calc(14px * var(--oc-scale)) !important;
            display: inline-block !important;
            overflow: hidden !important;
        }

        /* Color & Tinting channel button: keeps R/G/B letter and the
           current value label in a tidy column, centered vertically. */
        .oc-cb-btn {
            padding: 6px 4px;
            background: rgba(255,255,255,0.04);
            border: none;
            border-radius: 4px;
            color: #ddd;
            text-align: center;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 2px;
            min-height: 54px;
            cursor: pointer;
        }
        .oc-cb-btn .oc-cb-letter { font-size: calc(16px * var(--oc-scale)); font-weight: 700; }
        .oc-cb-btn .oc-cb-value  { font-size: calc(11px * var(--oc-scale)); color: #bbb; }
        .oc-cb-btn { transition: background 120ms, transform 80ms; }
        .oc-cb-btn:hover  { background: rgba(255,255,255,0.08); }
        .oc-cb-btn:active { transform: scale(0.97); background: rgba(255,255,255,0.02); }

        /* Range+number row — keeps the number input from being squished
           and the slider from overflowing its grid cell. */
        .oc-range-row {
            display: grid;
            grid-template-columns: 1fr calc(44px * var(--oc-scale));
            gap: 4px;
            align-items: center;
            min-width: 0;
        }
        .oc-range-row input[type=range]  { width: 100%; min-width: 0; }
        .oc-range-row input[type=number] { width: calc(44px * var(--oc-scale)); }

        /* Primary export button — flat, borderless */
        .oc-btn-export {
            background: rgba(90,140,192,0.2) !important;
            color: #cde !important;
            border: none !important;
            padding: calc(8px * var(--oc-scale)) calc(28px * var(--oc-scale)) !important;
            font-size: calc(14px * var(--oc-scale)) !important;
            font-weight: 600 !important;
            border-radius: 5px !important;
            box-shadow: none;
            cursor: pointer;
            transition: background 140ms, color 100ms;
            font-family: inherit;
        }
        .oc-btn-export:hover:not(:disabled) {
            background: rgba(90,140,192,0.3) !important; color: #fff !important;
        }
        .oc-btn-export:active:not(:disabled) { background: rgba(90,140,192,0.15) !important; }
        .oc-btn-export:disabled { opacity: 0.45; cursor: not-allowed; }

        /* Frame count preview chip */
        .oc-frame-chip {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 3px 8px;
            background: rgba(90,140,192,0.10);
            border: none;
            border-radius: 4px;
            font-size: calc(11px * var(--oc-scale));
            color: #9bd;
            width: fit-content;
        }
        .oc-frame-chip .material-icons { font-size: calc(13px * var(--oc-scale)); color: #6aa; }

        /* Display tabs — replaces the 24-slider wall of text */
        .oc-display-tabs {
            display: flex; gap: 0;
            margin-bottom: 12px;
            flex-wrap: nowrap;
            overflow-x: auto;
        }
        .oc-display-tab {
            background: transparent; border: none;
            color: #555; padding: 8px 12px;
            cursor: pointer; font-size: calc(11px * var(--oc-scale));
            white-space: nowrap;
            transition: color 120ms, background 120ms;
            border-radius: 4px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .oc-display-tab .material-icons { font-size: calc(18px * var(--oc-scale)); }
        .oc-display-tab:hover { color: #bbb; background: rgba(255,255,255,0.05); }
        .oc-display-tab.active {
            color: #5a8cc0;
            background: rgba(90,140,192,0.1);
        }

        /* Issue #10: "Open in Blockbench Display editor" button + note.
           Replaces the old in-dialog preview (BB's renderer can't live in a
           modal); we drive BB's own native Display editor instead. */
        .oc-display-preview {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
            margin-bottom: 12px;
            padding: 8px;
            background: rgba(0,0,0,0.18);
            border-radius: 6px;
        }
        .oc-open-display-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 7px 12px;
            border: none;
            border-radius: 4px;
            background: rgba(90,140,192,0.25);
            color: #cde;
            font-weight: 600;
            font-size: calc(12px * var(--oc-scale));
            cursor: pointer;
        }
        .oc-open-display-btn:hover:not(:disabled) { background: rgba(90,140,192,0.4); }
        .oc-open-display-btn:disabled { opacity: 0.45; cursor: default; }
        .oc-open-display-btn .material-icons { font-size: calc(16px * var(--oc-scale)); }
        .oc-display-preview-note {
            color: #888;
            font-size: calc(10px * var(--oc-scale));
            line-height: 1.3;
        }

        /* XYZ number inputs with colored corner indicators */
        .oc-xyz-row {
            display: grid;
            grid-template-columns: calc(70px * var(--oc-scale)) 1fr 1fr 1fr;
            gap: 6px;
            align-items: center;
            margin-bottom: 4px;
        }
        .oc-xyz-row > span { color: #777; font-size: calc(11px * var(--oc-scale)); }
        .oc-xyz-input {
            position: relative;
        }
        .oc-xyz-input input {
            width: 100%;
            padding: 5px 6px 5px 14px;
            background: rgba(255,255,255,0.04);
            border: none;
            border-radius: 3px;
            color: #ddd;
            font-family: 'Noto Sans', sans-serif;
            font-size: calc(12px * var(--oc-scale));
        }
        .oc-xyz-input { cursor: ew-resize; }
        .oc-xyz-input input { cursor: ew-resize; }
        .oc-xyz-input input:hover { background: rgba(255,255,255,0.07); }
        .oc-xyz-input input:focus { background: rgba(255,255,255,0.06); outline: 1px solid rgba(90,140,192,0.4); cursor: text; }
        .oc-xyz-input::before {
            content: '';
            position: absolute;
            left: 0; top: 0;
            width: 0; height: 0;
            border-style: solid;
            border-width: 6px 6px 0 0;
            border-radius: 3px 0 0 0;
            z-index: 1;
            pointer-events: none;
        }
        .oc-xyz-input.oc-x::before { border-color: #f55 transparent transparent transparent; }
        .oc-xyz-input.oc-y::before { border-color: #5b5 transparent transparent transparent; }
        .oc-xyz-input.oc-z::before { border-color: #58f transparent transparent transparent; }

        /* Texture thumbnail next to atlas checkboxes */
        .oc-tex-thumb {
            width: 22px; height: 22px;
            image-rendering: pixelated;
            border: none;
            border-radius: 3px;
            object-fit: contain;
            background: rgba(255,255,255,0.04);
            flex-shrink: 0;
        }

        /* Sticky footer — pinned to bottom of the nearest scroll container
           (BlockBench Dialog body). Transparent-ish background blends with
           the dialog so the footer doesn't look like a separate panel. */
        .oc-footer-sticky {
            position: sticky;
            bottom: 0;
            margin: 14px -16px -14px -16px;
            padding: 10px 16px;
            background: inherit;
            border-top: 1px solid rgba(255,255,255,0.06);
            display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
            z-index: 5;
        }
        /* Add a subtle backdrop only when content is actually scrollable.
           Implemented via JS toggle of .oc-footer-floating on the footer. */
        .oc-footer-sticky.oc-footer-floating {
            background: rgba(20,20,20,0.85);
            backdrop-filter: blur(4px);
            box-shadow: 0 -2px 8px rgba(0,0,0,0.25);
        }

        /* Collapse transition — slide-down + fade, matches tooltip drop */
        .oc-collapse-enter-active, .oc-collapse-leave-active {
            transition: opacity 180ms ease, transform 180ms ease;
            transform-origin: top center;
        }
        .oc-collapse-enter, .oc-collapse-leave-to {
            opacity: 0;
            transform: translateY(-6px) scaleY(0.96);
        }
        .oc-collapse-enter-to, .oc-collapse-leave {
            opacity: 1;
            transform: translateY(0) scaleY(1);
        }

        /* ── Guided tour (issue #4) ──────────────────────────────────────
           Single spotlight engine: .oc-tour-hole is a transparent box whose
           huge box-shadow IS the dim everywhere except over the target — its
           transparent center lets the real content show through bright (the
           "spotlight"). No separate full-screen dim, which would otherwise
           cover the target and defeat the hole. The card narrates. All sit
           above the BlockBench dialog (z ~100000+). */
        .oc-root-head {
            display: flex; justify-content: flex-end; align-items: center;
            margin: -4px 0 8px 0;
        }
        .oc-tour-btn {
            display: inline-flex; align-items: center; gap: 5px;
            padding: calc(3px * var(--oc-scale)) calc(9px * var(--oc-scale));
            border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
            background: rgba(255,255,255,0.04); color: #cde;
            font-size: calc(12px * var(--oc-scale)); cursor: pointer;
            transition: background 120ms, color 120ms;
        }
        .oc-tour-btn:hover { background: rgba(90,140,192,0.25); color: #fff; }
        .oc-tour-btn .material-icons { font-size: calc(15px * var(--oc-scale)); }

        .oc-tour-layer { position: fixed; inset: 0; z-index: 100000; }
        .oc-tour-hole {
            position: fixed; display: none;
            border-radius: 5px;
            box-shadow: 0 0 0 9999px rgba(0,0,0,0.62);
            outline: 2px solid rgba(90,140,192,0.9);
            outline-offset: 0;
            pointer-events: none;
            z-index: 100001;
            transition: left 160ms ease, top 160ms ease, width 160ms ease, height 160ms ease;
        }
        .oc-tour-card {
            position: fixed; left: 0; top: 0;
            width: calc(300px * var(--oc-scale)); max-width: calc(100vw - 24px);
            background: #1c1c1c; color: #e6e6e6;
            border: 1px solid rgba(90,140,192,0.4); border-radius: 6px;
            padding: calc(12px * var(--oc-scale)) calc(14px * var(--oc-scale));
            box-shadow: 0 8px 28px rgba(0,0,0,0.7);
            z-index: 100002;
            font-size: calc(12px * var(--oc-scale)); line-height: 1.5;
        }
        .oc-tour-card-title {
            font-weight: 700; font-size: calc(14px * var(--oc-scale));
            color: #cde; margin-bottom: 5px;
        }
        .oc-tour-card-body { color: #cfcfcf; margin-bottom: 11px; }
        .oc-tour-card-foot {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
        }
        .oc-tour-counter { color: #888; font-size: calc(11px * var(--oc-scale)); }
        .oc-tour-card-btns { display: inline-flex; gap: 6px; }
    `;
    function installStylesheet() {
        if (document.getElementById(STYLESHEET_ID)) return;
        const el = document.createElement('style');
        el.id = STYLESHEET_ID;
        el.textContent = STYLESHEET;
        document.head.appendChild(el);
    }
    function uninstallStylesheet() {
        const el = document.getElementById(STYLESHEET_ID);
        if (el) el.remove();
    }

    // =========================================================
    // Section 1.5: Persistent Settings (stored inside .bbmodel)
    // =========================================================
    // (PERSISTABLE_FIELDS, LANG and t() are hoisted above the
    // BBPlugin.register call — see top of file.)
    // Settings live on the active Project (Project.objcubed_data) and get
    // serialized into the .bbmodel via Codecs.project compile/parse hooks.
    //
    // Data shape — a flat settings object holds all dialog fields.
    //   {
    //     version: 1,
    //     settings: { ...dialog fields... },
    //   }
    // Older projects stored a single-preset backbone
    // ({ version, activePresetIndex, presets:[{name, settings}] }); the
    // multi-preset management UI was long-removed dead code. ensureDataRoot
    // migrates those blobs in place on first access.
    //
    // File key: model.objcubed   ·   Project key: Project.objcubed_data
    const PROJECT_DATA_KEY = 'objcubed_data';     // Project[key]
    const FILE_DATA_KEY    = 'objcubed';          // .bbmodel JSON field
    const DATA_VERSION     = 1;

    function makeEmptyDataRoot() {
        return {
            version: DATA_VERSION,
            settings: {},
        };
    }

    function ensureDataRoot() {
        if (!Project) return null;
        if (!Project[PROJECT_DATA_KEY]) Project[PROJECT_DATA_KEY] = makeEmptyDataRoot();
        const root = Project[PROJECT_DATA_KEY];
        // Migrate the legacy single-preset backbone → flat settings.
        if (root.presets) {
            const active = root.presets[root.activePresetIndex || 0];
            root.settings = (active && active.settings) || {};
            delete root.presets;
            delete root.activePresetIndex;
        }
        if (!root.settings || typeof root.settings !== 'object') root.settings = {};
        return root;
    }

    // Returns the active settings object (or null if no project is open).
    // Mutate in place to update — saveActiveSettings is provided for
    // replacement semantics.
    function loadActiveSettings() {
        const root = ensureDataRoot();
        return root ? root.settings : null;
    }

    function saveActiveSettings(settings) {
        const root = ensureDataRoot();
        if (root) root.settings = settings;
    }

    // Group body-part tags persist via OUR codec hooks, not BlockBench's property
    // serializer: BB does not reliably save custom Group properties to .bbmodel
    // (Cube/Mesh props persist, Group props get dropped), so the objcubed_body_part
    // set via the right-click menu was lost on save/reload. We snapshot {uuid: part}
    // on compile and re-apply it onto the groups after parse.
    function collectBodyPartTags() {
        const map = {};
        if (typeof Group === 'undefined' || !Group.all) return map;
        for (const g of Group.all) {
            const v = g && g.objcubed_body_part;
            if (typeof v === 'number' && v >= 0 && g.uuid) map[g.uuid] = v;
        }
        return map;
    }
    function applyBodyPartTags(map) {
        if (!map || typeof Group === 'undefined' || !Group.all) return;
        for (const g of Group.all) {
            const v = g && g.uuid ? map[g.uuid] : undefined;
            if (typeof v === 'number' && v >= -1 && v <= 7) g.objcubed_body_part = v;
        }
    }

    // Codec hooks — installed in onload, removed in onunload to keep plugin
    // reload idempotent.
    let _compileHandler = null;
    let _parseHandler = null;
    let _bodyPartTimer = null;   // deferred tag re-apply; cleared on uninstall

    function installProjectPersistence() {
        if (typeof Codecs === 'undefined' || !Codecs.project) return;
        _compileHandler = (data) => {
            if (!data || !data.model) return;
            const tags = collectBodyPartTags();
            const existing = Project && Project[PROJECT_DATA_KEY];
            // Write objcubed data if the user has any (settings) OR any group is tagged.
            if (existing || Object.keys(tags).length) {
                const root = ensureDataRoot();
                if (!root) return;
                root.bodyPartTags = tags;
                data.model[FILE_DATA_KEY] = root;
            }
        };
        _parseHandler = (data) => {
            if (!data || !data.model) return;
            const stored = data.model[FILE_DATA_KEY];
            if (!stored || !Project) return;
            Project[PROJECT_DATA_KEY] = stored;
            // Re-apply group tags AFTER parse finishes building the project (groups
            // don't exist yet at the 'parse' event), so deferred to the next tick.
            if (stored.bodyPartTags && typeof setTimeout === 'function') {
                const map = stored.bodyPartTags;
                if (_bodyPartTimer) clearTimeout(_bodyPartTimer);
                const _proj = (typeof Project !== 'undefined') ? Project : null;
                _bodyPartTimer = setTimeout(() => {
                    _bodyPartTimer = null;
                    if (((typeof Project !== 'undefined') ? Project : null) === _proj) applyBodyPartTags(map);
                }, 0);
            }
        };
        Codecs.project.on('compile', _compileHandler);
        Codecs.project.on('parse',   _parseHandler);
    }

    function uninstallProjectPersistence() {
        if (typeof Codecs === 'undefined' || !Codecs.project) return;
        // Blockbench's event API exposes removeListener; guard for older builds.
        const codec = Codecs.project;
        if (typeof codec.removeListener === 'function') {
            if (_compileHandler) codec.removeListener('compile', _compileHandler);
            if (_parseHandler)   codec.removeListener('parse',   _parseHandler);
        } else if (codec.events) {
            // Fallback: clear by reference if events bag is exposed.
            for (const evt of ['compile', 'parse']) {
                const arr = codec.events[evt];
                if (!Array.isArray(arr)) continue;
                for (let i = arr.length - 1; i >= 0; i--) {
                    if (arr[i] === _compileHandler || arr[i] === _parseHandler) arr.splice(i, 1);
                }
            }
        }
        _compileHandler = _parseHandler = null;
        if (_bodyPartTimer) { clearTimeout(_bodyPartTimer); _bodyPartTimer = null; }
    }

    // =========================================================
    // Section 1: PNG Encoder (Node.js zlib — bypasses canvas premultiplied alpha)
    // =========================================================
    function encodePNG(width, height, rgbaUint8) {
        const zlib = require('zlib');
        const crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c;
        }
        function crc32(buf) {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        }
        function chunk(type, data) {
            const tBuf = Buffer.from(type, 'ascii');
            const dBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(dBuf.length, 0);
            const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, dBuf])), 0);
            return Buffer.concat([lenBuf, tBuf, dBuf, crcBuf]);
        }
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
        ihdr[8] = 8; ihdr[9] = 6;
        // Respect a typed-array VIEW's byteOffset/byteLength: `Buffer.from(view.buffer)`
        // alone would wrap the whole underlying ArrayBuffer (ignoring a .subarray() span).
        const src = Buffer.isBuffer(rgbaUint8) ? rgbaUint8
            : (rgbaUint8 && rgbaUint8.buffer)
                ? Buffer.from(rgbaUint8.buffer, rgbaUint8.byteOffset, rgbaUint8.byteLength)
                : Buffer.from(rgbaUint8);
        const scanLen = 1 + width * 4;
        const raw = Buffer.alloc(height * scanLen, 0);
        for (let y = 0; y < height; y++) {
            raw[y * scanLen] = 0;
            src.copy(raw, y * scanLen + 1, y * width * 4, (y + 1) * width * 4);
        }
        const idat = zlib.deflateSync(raw, { level: 6 });
        return Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
        ]);
    }

    // =========================================================
    // Section 3: Animation Baking
    // =========================================================
    // Strategy: write animated world-space positions into mesh.vertices, call
    // Codecs.obj.compile() (which reads mesh.vertices), then restore.
    //
    // Uses DELTA matrix: delta = frameMatrix * inv(restMatrix).
    // At frameStart the delta is identity → frame 0 matches static export exactly.
    // Any constant scene scale in BB's THREE.js root cancels out.
    async function compileAnimatedObjFrames(anim, opts) {
        // compileAnimatedObjFrames v4
        const fps        = opts.fps        || anim.snapping || 20;
        const frameStart = opts.frameStart != null ? opts.frameStart : 0;
        const frameEnd   = opts.frameEnd   != null ? opts.frameEnd   : anim.length;
        // +1e-6 epsilon: (end-start)*fps lands just below the integer for many
        // user-typed decimals (1.16*25 = 28.999…) and a bare floor would drop
        // the final keyframe. previewFrameCount/frameCountPreview mirror this.
        const nframes    = Math.max(1, Math.floor((frameEnd - frameStart) * fps + 1e-6) + 1);
        const filterGroups = collectBoneUUIDs();
        const filterArm  = filterGroups.size > 0;


        // Save original (rest-pose) vertex positions
        const savedVertices = new Map();
        for (const mesh of Mesh.all)
            savedVertices.set(mesh.uuid, JSON.parse(JSON.stringify(mesh.vertices)));

        // Collect armature bones and build per-vertex weight influences.
        // Try Armature class first, then fall back to outliner scan by type string.
        const allBones = [];
        if (filterArm) {
            if (typeof Armature !== 'undefined' && Armature.all) {
                for (const arm of Armature.all)
                    for (const bone of arm.getAllBones()) allBones.push(bone);
            } else {
                // Fallback: walk outliner for elements with type 'armature_bone'
                (function findBones(children) {
                    for (const el of (children || [])) {
                        if ((el.type || '').toLowerCase() === 'armature_bone' && el.vertex_weights)
                            allBones.push(el);
                        if (el.children) findBones(el.children);
                    }
                })(Outliner.root);
            }
        }

        // Capture rest matrices using frame 0 of the animation as reference.
        // We select the animation first, go to frameStart, and capture bone
        // matrices there. This ensures consistent rest reference even if a
        // previous export left bones at the last animated frame.
        const savedTime = Timeline.time;
        const boneRestInverses = new Map();
        const meshRestWorlds = new Map();
        const restInverses = new Map(); // rigid parent-bone path

        // Save bone local transforms for restoration after export
        const savedBoneLocal = new Map();
        for (const bone of allBones) {
            if (!bone.mesh) continue;
            savedBoneLocal.set(bone.uuid, {
                p: bone.mesh.position.clone(),
                q: bone.mesh.quaternion.clone(),
                s: bone.mesh.scale.clone(),
            });
        }

        // Compute bone rest world matrices from static BB properties (bone.origin + bone.rotation)
        // by chaining through the BB outliner parent hierarchy.
        // We cannot use bone.mesh.matrixWorld because:
        //   1) Animation preview may be active, contaminating bone transforms
        //   2) Three.js hierarchy is nested (child bones under parent bones),
        //      so matrixWorld includes animated parent bone transforms
        if (allBones.length > 0) {
            const DEG2RAD = Math.PI / 180;
            const boneRestWorldMap = new Map(); // uuid → Matrix4
            const boneSet = new Set(allBones.map(b => b.uuid));

            // Get armature world matrix from a root bone's Three.js parent.
            // The armature itself doesn't animate, so this is stable.
            let armatureWorld = null;
            for (const bone of allBones) {
                if (!bone.mesh) continue;
                // Walk up BB outliner to find a root bone (no bone parent)
                let p = bone;
                while (p.parent && boneSet.has(p.parent.uuid)) p = p.parent;
                // p is now a root bone; its Three.js mesh parent is the armature
                if (p.mesh && p.mesh.parent) {
                    p.mesh.parent.updateWorldMatrix(true, false);
                    armatureWorld = new THREE.Matrix4().copy(p.mesh.parent.matrixWorld);
                    break;
                }
            }

            function getBoneRestWorld(bone) {
                if (boneRestWorldMap.has(bone.uuid)) return boneRestWorldMap.get(bone.uuid);
                const origin = bone.origin || [0, 0, 0];
                const rotation = bone.rotation || [0, 0, 0];
                const restLocal = new THREE.Matrix4();
                restLocal.makeRotationFromEuler(new THREE.Euler(
                    rotation[0] * DEG2RAD, rotation[1] * DEG2RAD, rotation[2] * DEG2RAD
                ));
                restLocal.setPosition(origin[0], origin[1], origin[2]);

                // Find parent bone in BB outliner hierarchy
                let parentBone = null;
                let pp = bone.parent;
                while (pp) {
                    if (boneSet.has(pp.uuid)) { parentBone = pp; break; }
                    pp = pp.parent;
                }

                const restWorld = new THREE.Matrix4();
                if (parentBone) {
                    restWorld.multiplyMatrices(getBoneRestWorld(parentBone), restLocal);
                } else if (armatureWorld) {
                    restWorld.multiplyMatrices(armatureWorld, restLocal);
                } else {
                    restWorld.copy(restLocal);
                }
                boneRestWorldMap.set(bone.uuid, restWorld);
                return restWorld;
            }

            for (const bone of allBones) {
                if (!bone.mesh) continue;
                boneRestInverses.set(bone.uuid,
                    new THREE.Matrix4().copy(getBoneRestWorld(bone)).invert());
            }
        }

        const results   = [];
        let firstMtl = '';
        try {
            anim.select();

            // Go to frameStart and preview
            Timeline.time = frameStart;
            Animator.preview();
            await new Promise(r => setTimeout(r, 0));
            // Mesh world matrices
            for (const mesh of Mesh.all) {
                if (mesh.mesh) {
                    mesh.mesh.updateWorldMatrix(true, false);
                    meshRestWorlds.set(mesh.uuid, {
                        world: new THREE.Matrix4().copy(mesh.mesh.matrixWorld),
                        inverse: new THREE.Matrix4().copy(mesh.mesh.matrixWorld).invert()
                    });
                }
            }
            // Per-parent-bone rest inverses (rigid-body path)
            for (const mesh of Mesh.all) {
                if (!(mesh.parent instanceof Group) || !mesh.parent.mesh) continue;
                mesh.parent.mesh.updateWorldMatrix(true, false);
                const inv = new THREE.Matrix4()
                    .copy(mesh.parent.mesh.matrixWorld)
                    .invert();
                restInverses.set(mesh.uuid, inv);
            }

            // Per-armature-bone influence maps (weighted path)
            const meshInfluences = new Map(); // mesh.uuid → Map<vkey, [{bone, weight}]>
            const meshToMeshId = new Map(); // mesh.uuid → meshShortID (hoisted for diagnostics)
            if (allBones.length > 0) {
                // Build per-mesh influence maps with meshID-aware matching.
                // BB weight keys use "meshShortID:vertexKey" format. We match
                // the meshShortID to the correct mesh via best-overlap to avoid
                // cross-mesh weight contamination when bare vertex keys collide.

                // Step 1: Collect meshID → Set<bareKey> from all bone weights
                const meshIdKeysets = new Map();
                const allWeightEntries = []; // [{bone, fullKey, meshId, bareKey, weight}]
                for (const bone of allBones) {
                    const src = bone.vertex_weights || bone.weights;
                    if (!src) continue;
                    const entries = src instanceof Map ? [...src.entries()] : Object.entries(src);
                    for (const [wk, w] of entries) {
                        const numW = +(w || 0);
                        if (numW <= 0) continue;
                        let meshId = null, bareKey = wk;
                        if (wk.includes(':')) {
                            const ci = wk.indexOf(':');
                            meshId = wk.substring(0, ci);
                            bareKey = wk.substring(ci + 1);
                            if (!meshIdKeysets.has(meshId)) meshIdKeysets.set(meshId, new Set());
                            meshIdKeysets.get(meshId).add(bareKey);
                        }
                        allWeightEntries.push({ bone, fullKey: wk, meshId, bareKey, weight: numW });
                    }
                }

                // Step 2: Map meshShortID → mesh element.
                // BB uses first 6 hex chars of uuid (no dashes) as the meshShortID
                // in weight keys. Try multiple prefix lengths for robustness.
                // meshToMeshId is hoisted above for diagnostic access
                const meshIdSet = new Set(meshIdKeysets.keys());
                const usedMeshIds = new Set();
                const usedMeshUuids = new Set();

                // Detect prefix length: find the length that gives 1:1 mapping
                const sampleId = [...meshIdSet][0] || '';
                const prefixLen = sampleId.length;

                // Build uuid-prefix → mesh lookup
                const byPrefix = new Map();
                for (const mesh of Mesh.all) {
                    if (!mesh.uuid) continue;
                    const stripped = mesh.uuid.replace(/-/g, '');
                    // Try the detected prefix length, plus common lengths 6, 8
                    for (const len of new Set([prefixLen, 6, 8])) {
                        if (len > 0 && len <= stripped.length) {
                            const key = stripped.substring(0, len);
                            if (!byPrefix.has(key)) byPrefix.set(key, mesh);
                        }
                    }
                    byPrefix.set(mesh.uuid, mesh); // full uuid too
                }

                // Match each meshID to a mesh
                for (const meshId of meshIdSet) {
                    const match = byPrefix.get(meshId);
                    if (match && !usedMeshUuids.has(match.uuid)) {
                        meshToMeshId.set(match.uuid, meshId);
                        usedMeshIds.add(meshId);
                        usedMeshUuids.add(match.uuid);
                    }
                }
                // Step 3: Build per-mesh influence maps using correct meshID
                for (const mesh of Mesh.all) {
                    const myMeshId = meshToMeshId.get(mesh.uuid);
                    const myKeys = new Set(Object.keys(mesh.vertices));
                    const vmap = new Map();
                    for (const { bone, meshId, bareKey, weight } of allWeightEntries) {
                        if (!myKeys.has(bareKey)) continue;
                        // Accept if: weight has matching meshID, or weight has no meshID prefix
                        if (meshId && myMeshId && meshId !== myMeshId) continue;
                        if (!vmap.has(bareKey)) vmap.set(bareKey, []);
                        vmap.get(bareKey).push({ bone, weight });
                    }
                    if (vmap.size > 0) meshInfluences.set(mesh.uuid, vmap);
                }
                if (meshInfluences.size === 0 && allBones.length > 0)
                    console.warn('[obj3] WARNING: No weight matches — meshes will stay in rest pose');
            }

            // Template for consistent face topology across frames
            let templateLines = null, templateVIdx = null;
            const warnedBones = new Set();

            // Bake each frame
            for (let i = 0; i < nframes; i++) {
                Timeline.time = frameStart + i / fps;
                Animator.preview();

                // Update all bone matrices once per frame
                if (allBones.length > 0)
                    for (const bone of allBones)
                        if (bone.mesh) bone.mesh.updateWorldMatrix(true, false);

                for (const mesh of Mesh.all) {
                    const weightMap = meshInfluences.get(mesh.uuid);
                    const original = savedVertices.get(mesh.uuid);

                    if (weightMap && weightMap.size > 0) {
                        // Weighted skinning with local↔world coordinate conversion
                        const mwd = meshRestWorlds.get(mesh.uuid);
                        const mw  = mwd ? mwd.world.elements : null;
                        const mwi = mwd ? mwd.inverse.elements : null;
                        for (const [vkey, pos] of Object.entries(original)) {
                            const influences = weightMap.get(vkey);
                            if (!influences) { mesh.vertices[vkey] = [...pos]; continue; }

                            const [lx, ly, lz] = pos;
                            // Local → world (rest pose)
                            const wx = mw ? mw[0]*lx+mw[4]*ly+mw[8]*lz+mw[12] : lx;
                            const wy = mw ? mw[1]*lx+mw[5]*ly+mw[9]*lz+mw[13] : ly;
                            const wz = mw ? mw[2]*lx+mw[6]*ly+mw[10]*lz+mw[14] : lz;
                            let nx = 0, ny = 0, nz = 0, tw = 0;
                            for (const { bone, weight } of influences) {
                                const restInv = boneRestInverses.get(bone.uuid);
                                if (!restInv) {
                                    if (!warnedBones.has(bone.uuid)) {
                                        console.warn(`[obj3] Bone "${bone.name || bone.uuid}" has no rest inverse — weights ignored`);
                                        warnedBones.add(bone.uuid);
                                    }
                                    continue;
                                }
                                const delta = new THREE.Matrix4()
                                    .multiplyMatrices(bone.mesh.matrixWorld, restInv);
                                const e = delta.elements;
                                nx += weight * (e[0]*wx+e[4]*wy+e[8]*wz+e[12]);
                                ny += weight * (e[1]*wx+e[5]*wy+e[9]*wz+e[13]);
                                nz += weight * (e[2]*wx+e[6]*wy+e[10]*wz+e[14]);
                                tw += weight;
                            }
                            if (tw > 0) {
                                const rx=nx/tw, ry=ny/tw, rz=nz/tw;
                                // World → local
                                mesh.vertices[vkey] = mwi
                                    ? [mwi[0]*rx+mwi[4]*ry+mwi[8]*rz+mwi[12],
                                       mwi[1]*rx+mwi[5]*ry+mwi[9]*rz+mwi[13],
                                       mwi[2]*rx+mwi[6]*ry+mwi[10]*rz+mwi[14]]
                                    : [rx, ry, rz];
                            } else {
                                mesh.vertices[vkey] = [...pos];
                            }
                            // No longer logging per-vertex: round-trip verify catches encoding errors
                        }
                    } else if (mesh.parent instanceof Group && mesh.parent.mesh
                               && (mesh.parent.type || '').toLowerCase() === 'armature_bone') {
                        // Rigid path for meshes parented to armature bones
                        // (regular group keyframe transforms are handled by BB's OBJ compiler)
                        mesh.parent.mesh.updateWorldMatrix(true, false);
                        const restInv = restInverses.get(mesh.uuid);
                        if (!restInv) continue;
                        const delta = new THREE.Matrix4()
                            .multiplyMatrices(mesh.parent.mesh.matrixWorld, restInv);
                        const e = delta.elements;
                        for (const [vkey, lp] of Object.entries(original)) {
                            const [x, y, z] = lp;
                            mesh.vertices[vkey] = [
                                e[0]*x + e[4]*y + e[8]*z  + e[12],
                                e[1]*x + e[5]*y + e[9]*z  + e[13],
                                e[2]*x + e[6]*y + e[10]*z + e[14],
                            ];
                        }
                    }
                }

                const compile = () => Codecs.obj.compile();
                const safeCompile = () => withNonGeoHidden(compile);
                const c = filterArm ? await withArmatureHidden(safeCompile) : await safeCompile();
                let objStr = typeof c === 'string' ? c : (c.obj || '');
                if (i === 0) firstMtl = (typeof c === 'object' && c.mtl) ? c.mtl : '';
                if (filterGroups) objStr = filterObjBones(objStr, filterGroups);

                // Template approach: use frame 0's face topology for all frames.
                // Codecs.obj.compile() can produce different face indices when vertex
                // positions change (triangulation, vertex welding), which breaks
                // objmc animation. Fix: freeze everything except 'v ' lines.
                if (i === 0) {
                    templateLines = objStr.split('\n');
                    templateVIdx = [];
                    for (let li = 0; li < templateLines.length; li++)
                        if (templateLines[li].startsWith('v ')) templateVIdx.push(li);
                    // Debug: log group→vertex structure
                    let dbgGroup = null;
                    let dbgVCount = 0;
                    const dbgGroups = [];
                    for (const l of templateLines) {
                        if (l.startsWith('o ') || l.startsWith('g ')) {
                            if (dbgGroup) dbgGroups.push(`${dbgGroup}:${dbgVCount}v`);
                            dbgGroup = l.substring(2).trim(); dbgVCount = 0;
                        } else if (l.startsWith('v ')) dbgVCount++;
                    }
                    if (dbgGroup) dbgGroups.push(`${dbgGroup}:${dbgVCount}v`);
                    console.log(`[obj3-anim] F0 template: ${templateVIdx.length} vertices, groups: [${dbgGroups.join(', ')}]`);
                } else if (templateLines) {
                    // Extract v-lines from current frame and substitute into template
                    const curVLines = [];
                    const curLines = objStr.split('\n');
                    // Debug: check if group order changed
                    let dbgGroup = null, dbgVCount = 0;
                    const dbgGroups = [];
                    for (const l of curLines) {
                        if (l.startsWith('o ') || l.startsWith('g ')) {
                            if (dbgGroup) dbgGroups.push(`${dbgGroup}:${dbgVCount}v`);
                            dbgGroup = l.substring(2).trim(); dbgVCount = 0;
                        } else if (l.startsWith('v ')) { curVLines.push(l); dbgVCount++; }
                    }
                    if (dbgGroup) dbgGroups.push(`${dbgGroup}:${dbgVCount}v`);
                    if (i <= 2) console.log(`[obj3-anim] F${i}: ${curVLines.length} vertices, groups: [${dbgGroups.join(', ')}]`);
                    if (curVLines.length === templateVIdx.length) {
                        const tpl = [...templateLines];
                        for (let vi = 0; vi < templateVIdx.length; vi++)
                            tpl[templateVIdx[vi]] = curVLines[vi];
                        objStr = tpl.join('\n');
                    } else {
                        console.warn(`[obj3] F${i}: vertex count mismatch (template=${templateVIdx.length}, cur=${curVLines.length}), using raw OBJ`);
                    }
                }
                results.push(objStr);

                // Restore for next frame
                for (const mesh of Mesh.all) {
                    const saved = savedVertices.get(mesh.uuid);
                    if (saved) for (const [vk, p] of Object.entries(saved)) mesh.vertices[vk] = [...p];
                }

                if (opts.onProgress) opts.onProgress(i + 1, nframes);
                await new Promise(r => setTimeout(r, 0));
            }
        } finally {
            // Restore timeline and preview
            Timeline.time = savedTime;
            Animator.preview();
            // Restore mesh vertices
            for (const mesh of Mesh.all) {
                const saved = savedVertices.get(mesh.uuid);
                if (saved) for (const [vk, p] of Object.entries(saved)) mesh.vertices[vk] = [...p];
            }
            // Restore bone local transforms (prevent bones staying at last frame)
            for (const bone of allBones) {
                const s = savedBoneLocal.get(bone.uuid);
                if (s && bone.mesh) {
                    bone.mesh.position.copy(s.p);
                    bone.mesh.quaternion.copy(s.q);
                    bone.mesh.scale.copy(s.s);
                    bone.mesh.updateMatrixWorld();
                }
            }
        }
        return { objs: results, mtl: firstMtl };
    }

    // =========================================================
    // Section 4: OBJ Parsing
    // =========================================================

    // Remove bone groups from an OBJ string by UUID and re-index v/vt references.
    // Codecs.obj.compile() ignores visibility on armature_bone elements, so we
    // post-process the OBJ text to strip their geometry.
    function filterObjBones(objStr, boneUUIDs) {
        if (!boneUUIDs || boneUUIDs.size === 0) return objStr;

        const lines = objStr.split('\n');

        // Pass 1: find which v/vt indices belong to bone groups
        let curBone = false, vN = 0, vtN = 0;
        const boneV = new Set(), boneVt = new Set();
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('o ') || t.startsWith('g ')) {
                curBone = boneUUIDs.has(t.substring(2).trim());
            } else if (t.startsWith('v '))  { vN++;  if (curBone) boneV.add(vN);  }
              else if (t.startsWith('vt ')) { vtN++; if (curBone) boneVt.add(vtN); }
        }
        if (boneV.size === 0) return objStr;

        // Build old→new index maps (1-based)
        const vMap = new Array(vN + 1), vtMap = new Array(vtN + 1);
        let nv = 0, nvt = 0;
        for (let i = 1; i <= vN; i++)  vMap[i]  = boneV.has(i)  ? 0 : ++nv;
        for (let i = 1; i <= vtN; i++) vtMap[i] = boneVt.has(i) ? 0 : ++nvt;

        // Pass 2: rebuild OBJ without bone sections, remap face indices
        curBone = false;
        const out = [];
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('o ') || t.startsWith('g ')) {
                curBone = boneUUIDs.has(t.substring(2).trim());
                if (!curBone) out.push(line);
            } else if (curBone) {
                continue;
            } else if (t.startsWith('f ')) {
                const parts = t.split(/\s+/);
                const remap = ['f'];
                let ok = true;
                for (let i = 1; i < parts.length; i++) {
                    if (!parts[i]) continue;
                    const r = parts[i].split('/');
                    const vi  = r[0] ? vMap[+r[0]]  : 0;
                    const vti = r[1] ? vtMap[+r[1]] : 0;
                    if (r[0] && !vi) { ok = false; break; }
                    let s = '' + (vi || '');
                    if (r.length > 1) s += '/' + (vti || '');
                    if (r.length > 2) s += '/' + (r[2] || '');
                    remap.push(s);
                }
                if (ok) out.push(remap.join(' '));
            } else {
                out.push(line);
            }
        }
        return out.join('\n');
    }

    function parseObj(content, expectedFaces) {
        const d = { positions: [], uvs: [], faces: [], faceMaterials: [], faceGroups: [], faceBlocks: [] };
        let currentMaterial = null;
        let currentGroup = null;
        let currentBlock = -1;
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line || line[0] === '#') continue;
            const parts = line.split(/\s+/);
            switch (parts[0]) {
                case 'v':  d.positions.push([+parts[1]||0, +parts[2]||0, +parts[3]||0]); break;
                case 'vt': d.uvs.push([+parts[1]||0, +parts[2]||0]); break;
                case 'usemtl': currentMaterial = parts.slice(1).join(' '); break;
                case 'o':
                case 'g': currentGroup = parts.slice(1).join(' '); currentBlock++; break;
                case 'f': {
                    const face = [];
                    for (let i = 1; i < parts.length; i++) {
                        if (!parts[i]) continue;
                        const refs = parts[i].split('/');
                        face.push([refs[0] ? +refs[0]-1 : 0, refs[1] ? +refs[1]-1 : 0]);
                    }
                    d.faces.push(face);
                    d.faceMaterials.push(currentMaterial);
                    d.faceGroups.push(currentGroup);
                    d.faceBlocks.push(currentBlock);
                    break;
                }
            }
        }
        if (expectedFaces > 0 && d.faces.length !== expectedFaces)
            throw new Error(`Face count mismatch: expected ${expectedFaces}, got ${d.faces.length}`);
        return d;
    }

    // Parse MTL string to map material names → texture filenames
    function parseMtl(mtlString) {
        const map = new Map(); // materialName → textureFilename
        let currentMtl = null;
        for (const rawLine of (mtlString || '').split('\n')) {
            const line = rawLine.trim();
            if (!line || line[0] === '#') continue;
            const parts = line.split(/\s+/);
            if (parts[0] === 'newmtl') currentMtl = parts.slice(1).join(' ');
            else if (parts[0] === 'map_Kd' && currentMtl) map.set(currentMtl, parts.slice(1).join(' '));
        }
        return map;
    }

    // Match MTL texture filenames to Texture.all indices
    function buildMaterialToTexMap(mtlMap) {
        const result = new Map(); // materialName → Texture.all index
        for (const [mtlName, texFile] of mtlMap) {
            // Strip path and extension for matching
            const baseName = texFile.replace(/^.*[/\\]/, '').replace(/\.\w+$/, '').toLowerCase();
            const texFileLower = texFile.toLowerCase();
            const idx = Texture.all.findIndex(t => {
                const tName = (t.name || '').replace(/\.\w+$/, '').toLowerCase();
                return tName === baseName || tName === texFileLower;
            });
            if (idx >= 0) result.set(mtlName, idx);
        }
        return result;
    }

    // =========================================================
    // Section 5: Vertex Indexing
    // =========================================================
    function buildVertexData(objContents, atlasInfo, partRef, faceToPart) {
        // atlasInfo: null (single texture) or { materialToTexIdx, offsets, width, height }
        // partRef/faceToPart: per-part re-centering (armor only); null = no centering.
        const count = [0, 0];
        const mem   = { pos: Object.create(null), uv: Object.create(null) };
        const data  = { positions: [], uvs: [], vertices: [] };

        let uvClamped = false;
        function remapUV(uv, material) {
            if (!atlasInfo) return uv;
            const texIdx = atlasInfo.materialToTexIdx.get(material);
            const off = texIdx !== undefined ? atlasInfo.offsets.get(texIdx) : null;
            if (!off) return uv;
            // Clamp BEFORE remapping: an out-of-range (tiling/negative) UV scaled
            // into the atlas lands inside a NEIGHBORING texture's region while
            // still passing the post-remap [0,1] checks — silently sampling the
            // wrong texture. Clamp per-texture and flag it so buildOutput warns
            // (same behavior the single-texture path gets via uvPixels).
            const u = Math.max(0, Math.min(1, uv[0]));
            const v = Math.max(0, Math.min(1, uv[1]));
            if (Math.abs(u - uv[0]) > 1e-6 || Math.abs(v - uv[1]) > 1e-6) uvClamped = true;
            // V remap, uv_height-aware. BB uv space covers the FIRST (top) frame
            // for BB-animated textures (uvh = frame height) and the whole image
            // otherwise (uvh = h, reduces to the classic v*h + off.y). The atlas
            // stores each region V-FLIPPED, so the image-top uv area lands at the
            // BOTTOM of the region: off.y + off.h - uvh + v*uvh. This is exactly
            // the frame-0 band the shader cycles from.
            const uvh = off.uvh || off.h;
            return [
                u * off.w / atlasInfo.width,
                (v * uvh + off.y + off.h - uvh) / atlasInfo.height
            ];
        }

        function indexVert(o, vert, material, part) {
            let pos = o.positions[vert[0]] || [0,0,0];
            if (partRef) { const r = partRef.get(part); if (r) pos = [pos[0]-r[0], pos[1]-r[1], pos[2]-r[2]]; }
            const rawUv = o.uvs[vert[1]]    || [0,0];
            const uv = remapUV(rawUv, material);
            const pk  = pos.join(',');
            const uk  = uv[0].toFixed(8) + ',' + uv[1].toFixed(8);
            let pi = mem.pos[pk];
            if (pi === undefined) { pi = count[0]++; mem.pos[pk] = pi; data.positions.push(pos); }
            let ui = mem.uv[uk];
            if (ui === undefined) { ui = count[1]++; mem.uv[uk] = ui; data.uvs.push(uv); }
            data.vertices.push([pi, ui]);
        }

        function indexObj(o) {
            for (let fi = 0; fi < o.faces.length; fi++) {
                const face = o.faces[fi];
                const mtl = o.faceMaterials[fi];
                const part = faceToPart ? faceToPart[fi] : -1;
                const n = Math.min(4, face.length);
                for (let i = 0; i < n; i++) indexVert(o, face[i], mtl, part);
                // Pad a triangle to a quad by repeating the LAST vertex (v0,v1,v2,v2):
                // the 2nd sub-triangle (v0,v2,v2) is then zero-area/degenerate. Repeating
                // the MIDDLE vertex instead gave (v0,v2,v1) — a reverse-wound coincident
                // face that flickers / z-fights.
                if (face.length === 3) indexVert(o, face[2], mtl, part);
                if (face.length > 4) console.warn('[obj3] N-Gon — only first 4 verts used');
            }
        }

        const firstObj = parseObj(objContents[0], 0);
        const nfaces   = firstObj.faces.length;
        indexObj(firstObj);
        for (let f = 1; f < objContents.length; f++)
            indexObj(parseObj(objContents[f], nfaces));

        return { data, nfaces, faceGroups: firstObj.faceGroups, faceBlocks: firstObj.faceBlocks, uvClamped };
    }

    // =========================================================
    // Section 6: Pixel Encoding
    // =========================================================
    const u24 = v => [Math.trunc(v/65536)&255, Math.trunc(v/256)&255, Math.trunc(v)&255];

    function posPixels(pos, scale, off) {
        return pos.map((v, i) => [...u24(8388608 + v*65536*scale + off[i]*65536), 255]);
    }
    function uvPixels(uv) {
        // Clamp to [0,1]: the shader samples within one frame, so a UV outside the
        // unit square (tiling / negative) would otherwise wrap or read garbage
        // (v*65535 overflows the 16 low bits the shader reads). A buildOutput check
        // warns the user when this clamp actually changed anything.
        return uv.map(v => [...u24(Math.max(0, Math.min(1, v)) * 65535), 255]);
    }
    function vertPixels(vert) {
        const [poi, uvi] = vert;
        return [[...u24(poi), 255], [...u24(uvi), 255]];
    }

    function getTextureRGBA(bbTexture) {
        return new Promise((resolve, reject) => {
            const src = bbTexture.source || (bbTexture.img && bbTexture.img.src);
            if (!src) { reject(new Error('Texture has no source data')); return; }
            const img = new Image();
            img.onload = () => {
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0);
                const id = cv.getContext('2d').getImageData(0, 0, w, h);
                resolve({ data: id.data, width: w, height: h });
            };
            img.onerror = () => reject(new Error('Failed to decode texture: ' + bbTexture.name));
            img.src = src;
        });
    }

    // Build a texture atlas by stacking multiple textures vertically.
    // Returns { data: Uint8Array, width, height, offsets: Map<texIdx, {x,y,w,h}> }
    async function buildAtlas(texIndices) {
        if (!texIndices || texIndices.length === 0) throw new Error('No textures selected for atlas');
        const texDatas = [];
        for (const idx of texIndices) {
            texDatas.push({ idx, rgba: await getTextureRGBA(Texture.all[idx]) });
        }
        const atlasW = Math.max(...texDatas.map(t => t.rgba.width));
        let atlasH = 0;
        const offsets = new Map(); // texIdx → { x, y, w, h, uvh }
        for (const t of texDatas) {
            // uvh = the texture's BLOCKBENCH UV-space height. For a texture marked
            // animated IN BLOCKBENCH, BB sets its UV size to ONE FRAME and the OBJ
            // codec emits vt normalized to that frame — so remapUV must scale V by
            // uvh, not the full image height. Plain textures: uvh == image height.
            const bbTex = Texture.all[t.idx];
            const uvh = (bbTex && +bbTex.uv_height > 0) ? +bbTex.uv_height : t.rgba.height;
            offsets.set(t.idx, { x: 0, y: atlasH, w: t.rgba.width, h: t.rgba.height, uvh });
            atlasH += t.rgba.height;
        }
        const data = new Uint8Array(atlasW * atlasH * 4);
        for (const t of texDatas) {
            const off = offsets.get(t.idx);
            const src = t.rgba;
            for (let row = 0; row < src.height; row++) {
                const dstOffset = ((off.y + row) * atlasW + off.x) * 4;
                const srcOffset = row * src.width * 4;
                data.set(src.data.subarray(srcOffset, srcOffset + src.width * 4), dstOffset);
            }
        }
        return { data, width: atlasW, height: atlasH, offsets };
    }

    // =========================================================
    // Section 7: Per-Context Logic
    // =========================================================

    // Remove non-geometry elements (cameras, etc.) from the outliner tree
    // during OBJ compile. Setting visibility doesn't work because
    // Codecs.obj.compile() ignores it for some element types (same issue as
    // armature_bone). Instead we splice them out and restore after compile.
    // 'armature' is included because it's a container for child meshes.
    const GEO_WHITELIST = new Set(['cube', 'mesh', 'group', 'armature']);
    async function withNonGeoHidden(fn) {
        const removed = []; // [{arr, idx, el}]
        (function walk(children) {
            if (!children) return;
            for (let i = children.length - 1; i >= 0; i--) {
                const el = children[i];
                const t = (el.type || '').toLowerCase();
                if (!GEO_WHITELIST.has(t)) {
                    removed.push({ arr: children, idx: i, el });
                    children.splice(i, 1);
                } else if (el.children) {
                    walk(el.children);
                }
            }
        })(Outliner.root);
        try { return await fn(); }
        finally {
            // Restore in reverse order to preserve indices
            for (let i = removed.length - 1; i >= 0; i--) {
                const { arr, idx, el } = removed[i];
                arr.splice(idx, 0, el);
            }
        }
    }

    function collectEmissiveMap() {
        const map = new Map();
        (function walk(children) {
            for (const el of (children || [])) {
                const n = (el.name || '').toLowerCase();
                const level = +(el.objcubed_light_emission) || 0;
                const nameMatch = n.endsWith('_e') || n.startsWith('emissive');
                if (level > 0 || nameMatch) {
                    const val = level > 0 ? level : 15;
                    const prev = map.get(n) || 0;
                    if (val > prev) map.set(n, val);
                }
                if (el.children) walk(el.children);
            }
        })(Outliner.root);
        return map;
    }

    // Per-piece armor: map a face's group/element name to a body-part id (0..7),
    // mirroring collectEmissiveMap. A face's part comes from the nearest ancestor
    // GROUP carrying objcubed_body_part (set via the group context menu), or its own;
    // element/group NAMES matching a part also work (fallback, also used by tests).
    const PART_NAME_TO_ID = {
        body: 0, chest: 0, torso: 0, head: 1,
        right_arm: 2, rightarm: 2, arm_r: 2, r_arm: 2,
        left_arm: 3, leftarm: 3, arm_l: 3, l_arm: 3,
        right_leg: 4, rightleg: 4, leg_r: 4, r_leg: 4,
        left_leg: 5, leftleg: 5, leg_l: 5, l_leg: 5,
        right_foot: 6, rightfoot: 6, foot_r: 6, r_foot: 6, right_boot: 6, boot_r: 6,
        left_foot: 7, leftfoot: 7, foot_l: 7, l_foot: 7, left_boot: 7, boot_l: 7,
    };
    function normPartName(s) { return (s || '').toLowerCase().trim().replace(/[ \-]+/g, '_'); }
    // Export helper: turn the dialog's per-texture checkbox array into the list of
    // checked texture indices. Array-guarded so a corrupt/hand-edited project whose
    // persisted atlasTexChecked is a non-array (null/string/object) doesn't make
    // Export throw `TypeError: …map is not a function` (Task C1).
    function atlasTexIndicesFrom(checked) {
        return (Array.isArray(checked) ? checked : []).map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    }
    function nameToPart(s) { const n = normPartName(s); return (n in PART_NAME_TO_ID) ? PART_NAME_TO_ID[n] : -1; }
    // An element's part: nearest self-or-ancestor with objcubed_body_part set, else a
    // self-or-ancestor whose NAME matches a part (closer wins). -1 if none.
    function partOfElement(el) {
        let cur = el;
        while (cur && cur !== 'root' && typeof cur === 'object') {
            const own = cur.objcubed_body_part;
            if (typeof own === 'number' && own >= 0) return own;
            const byName = nameToPart(cur.name);
            if (byName >= 0) return byName;
            cur = cur.parent;
        }
        return -1;
    }
    // Encode each geo element's part into a TEMPORARY unique name token so the OBJ codec
    // writes it into the `o` line: then every face carries ITS OWN element's part, with
    // NO dependence on the codec's emit order (which does not match an Outliner walk for
    // nested groups/meshes -- the cause of scrambled body<->arm assignment). Also carries
    // the emissive level so emissive survives the rename. Returns a restore() fn.
    function applyPartTokenNames() {
        if (typeof Outliner === 'undefined' || !Outliner.elements) return () => {};
        const isGeo = el => (typeof Cube !== 'undefined' && el instanceof Cube) ||
                            (typeof Mesh !== 'undefined' && el instanceof Mesh);
        const saved = [];
        let i = 0;
        for (const el of Outliner.elements) {
            if (!isGeo(el)) continue;
            const part = partOfElement(el);                 // -1..7
            const emis = Math.max(0, Math.round(+el.objcubed_light_emission || 0));
            saved.push([el, el.name]);
            el.name = `ocp${part + 1}e${emis}i${i++}`;      // part+1 -> non-negative (no '-' in OBJ name)
        }
        return () => { for (const [el, n] of saved) el.name = n; };
    }
    // Parse a face token written by applyPartTokenNames; null if not a token.
    function parseFaceToken(g) {
        const m = /^ocp(\d+)e(\d+)i\d+$/.exec(g || '');
        return m ? { part: (+m[1]) - 1, emis: +m[2] } : null;
    }
    // Geo elements (Cube/Mesh) in OBJ-emit order (depth-first), each -> its part. The
    // BB OBJ codec emits one `o` block per geo element in this order, so the Nth block
    // maps to the Nth entry here. Empty when Outliner is unavailable (unit tests).
    function collectGeoElementParts() {
        const parts = [];
        if (typeof Outliner === 'undefined' || !Outliner.root) return parts;
        const isGeo = el => (typeof Cube !== 'undefined' && el instanceof Cube) ||
                            (typeof Mesh !== 'undefined' && el instanceof Mesh);
        (function walk(children) {
            for (const el of (children || [])) {
                if (el.children && el.children.length) walk(el.children);
                else if (isGeo(el)) parts.push(partOfElement(el));
            }
        })(Outliner.root);
        return parts;
    }
    // name (normalized) -> part, from group tags keyed by element/group name. Only
    // reliable when names are unique; the fallback path (tests, or count mismatch).
    function collectBodyPartMap() {
        const map = new Map();
        if (typeof Outliner === 'undefined' || !Outliner.root) return map;
        (function walk(children, inherited) {
            for (const el of (children || [])) {
                let part = inherited;
                const own = el.objcubed_body_part;
                if (typeof own === 'number' && own >= 0) part = own;
                if (typeof part === 'number' && part >= 0) map.set(normPartName(el.name), part);
                if (el.children) walk(el.children, part);
            }
        })(Outliner.root, -1);
        return map;
    }
    // Per-face part id (0..7) or -1. ROBUST path: OBJ block index -> Nth geo element
    // -> its part (immune to duplicate element names, which collided the name map).
    // FALLBACK (no Outliner in tests, or block/element count mismatch): by NAME.
    function buildFaceToPart(faceGroups, faceBlocks) {
        // Armor path: faces carry a part-encoded token (order- and collision-proof).
        if (faceGroups && faceGroups.some(parseFaceToken)) {
            return faceGroups.map(g => { const t = parseFaceToken(g); return t ? t.part : -1; });
        }
        const blockParts = collectGeoElementParts();
        const blockCount = (faceBlocks && faceBlocks.length)
            ? faceBlocks.reduce((m, b) => (b > m ? b : m), -1) + 1 : 0;
        if (blockParts.length && blockCount === blockParts.length) {
            return faceBlocks.map(b => (b >= 0 && b < blockParts.length) ? blockParts[b] : -1);
        }
        if (blockParts.length && blockCount && blockCount !== blockParts.length) {
            console.warn(`[obj³] ${blockCount} OBJ blocks vs ${blockParts.length} geo elements — name matching fallback. Name part groups/cubes (body, right_arm, left_leg, ...).`);
        }
        const partMap = collectBodyPartMap();
        return (faceGroups || []).map(g => {
            const n = normPartName(g);
            return partMap.has(n) ? partMap.get(n) : nameToPart(g);
        });
    }
    // Per-part attach point from the tagged group's PIVOT (origin). The artist sets the
    // group pivot where the part attaches to the body; subtracting it makes the geometry
    // pivot-relative, so it anchors exactly as drawn regardless of model size/position.
    // Map<partId,[x,y,z]> in OBJ space (blocks); only groups whose pivot is set (!=0,0,0).
    function collectPartPivots() {
        const m = new Map();
        if (typeof Group === 'undefined' || !Group.all) return m;
        for (const g of Group.all) {
            const v = g && g.objcubed_body_part;
            if (typeof v !== 'number' || v < 0 || m.has(v)) continue;
            const o = g.origin;
            if (!Array.isArray(o) || (o[0] === 0 && o[1] === 0 && o[2] === 0)) continue; // unset -> bbox fallback
            m.set(v, [o[0] / 16, o[1] / 16, o[2] / 16]); // BB model units -> blocks (OBJ space)
        }
        return m;
    }
    // Per-part reference: the tagged group's PIVOT if set, else bbox-CENTER in X/Z +
    // bbox-MIN in Y (the base, for parts modelled above the grid). Subtracting it makes
    // each part pivot/centre-relative so it anchors the same wherever it's drawn.
    // Map<partId,[x,y,z]>; parts id<0 skipped.
    function computePartCenters(o, faceToPart) {
        const box = new Map(); // part -> { min:[x,y,z], max:[x,y,z] }
        for (let fi = 0; fi < o.faces.length; fi++) {
            const part = faceToPart ? faceToPart[fi] : -1;
            if (part < 0) continue;
            let b = box.get(part);
            if (!b) { b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; box.set(part, b); }
            for (const vt of o.faces[fi]) {
                const p = o.positions[vt[0]] || [0, 0, 0];
                for (let k = 0; k < 3; k++) { if (p[k] < b.min[k]) b.min[k] = p[k]; if (p[k] > b.max[k]) b.max[k] = p[k]; }
            }
        }
        // Prefer the tagged group's PIVOT (attach point the artist set) so a part anchors
        // exactly where it's drawn, on any model. Fall back to bbox-center X/Z + base Y
        // when the group pivot is unset (default 0,0,0).
        const pivots = collectPartPivots();
        const ref = new Map();
        for (const [part, b] of box) {
            const piv = pivots.get(part);
            ref.set(part, piv || [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]);
        }
        return ref;
    }

    // Collect UUIDs of all armature_bone elements (used for OBJ post-processing).
    function collectBoneUUIDs() {
        const uuids = new Set();
        (function walk(children) {
            for (const el of (children || [])) {
                if ((el.type || '').toLowerCase() === 'armature_bone')
                    uuids.add(el.uuid);
                if (el.children) walk(el.children);
            }
        })(Outliner.root);
        return uuids;
    }

    // Collect OBJ group names of hidden mesh/cube elements.
    // Check if the project has armature/bone/locator/null_object elements.
    function hasNonGeometryElements() {
        const NON_GEO = new Set(['armature', 'armature_bone', 'locator', 'null_object']);
        function walk(children) {
            for (const el of (children || [])) {
                if (NON_GEO.has((el.type || '').toLowerCase())) return true;
                if (el.children && walk(el.children)) return true;
            }
            return false;
        }
        return walk(Outliner.root);
    }

    // Rough face count of the visible geometry — used by the preview banner.
    // Walks Outliner, skipping armature_bone/locator/null_object subtrees when
    // filterArmature is on (mirrors withArmatureHidden() visibility hack).
    // Quads count as 1 (matches Codecs.obj.compile output).
    function estimateFaceCount(filterArmature) {
        const SKIP_TYPES = filterArmature
            ? new Set(['armature_bone', 'locator', 'null_object'])
            : new Set(['locator', 'null_object']);
        let total = 0;
        function walk(children) {
            for (const el of (children || [])) {
                const t = (el.type || '').toLowerCase();
                if (SKIP_TYPES.has(t)) continue;
                if (el.visibility === false) continue;
                if (t === 'cube') {
                    // Standard cube has 6 faces; respect per-face texture==null hidden faces.
                    if (el.faces) {
                        for (const key of ['north','east','south','west','up','down']) {
                            if (el.faces[key] && el.faces[key].texture !== null) total++;
                        }
                    } else total += 6;
                } else if (t === 'mesh') {
                    if (el.faces) total += Object.keys(el.faces).length;
                }
                if (el.children) walk(el.children);
            }
        }
        walk(Outliner.root);
        return total;
    }

    // Estimate the encoded PNG dimensions and byte size given face count,
    // frame count and texture dimensions. Mirrors the math in buildOutput()
    // (Section 8) but uses face count as a proxy for positions/uvs/vertices.
    function estimateOutputPng(faces, frames, tw, th, nopow) {
        if (!faces || !tw || !th) return null;
        // Per buildOutput(): vertices = nfaces * 4 per frame; positions/uvs roughly bounded by nfaces.
        const nverts = faces * 4;
        const uvH = Math.ceil(faces / tw);
        const texH = th;
        const vpH = Math.ceil(faces * 3 / tw);          // positions ≈ nfaces (3 bytes/vert × 1 vert/face overcounts; OK for warning math)
        const vtH = Math.ceil(faces * 2 / tw);
        const vH  = Math.ceil(nverts * frames * 2 / tw);
        let ty = 2 + uvH + texH + vpH + vtH + vH;
        if (!nopow) ty = 1 << Math.ceil(Math.log2(ty || 1));
        const rawBytes = tw * ty * 4;
        // PNG with zlib level 6 typically compresses pixel data to ~30-50%.
        const approxBytes = Math.round(rawBytes * 0.4);
        return { tw, ty, rawBytes, approxBytes };
    }


    // Temporarily adjust visibility for OBJ export:
    //   - SHOW armature container (so child visibility is respected by codec)
    //   - SHOW mesh/cube elements under armature (they are the real geometry)
    //   - HIDE armature_bone, locator, null_object (non-geometry / bone shapes)
    // In Generic Model format the mesh geometry lives inside the armature
    // hierarchy (often hidden), while bones are visible and export as
    // diamond/octahedron shapes we don't want.
    async function withArmatureHidden(fn) {
        // Store direct element references for reliable restoration
        const saved = []; // [{el, originalVis}]
        function saveAndSet(el, vis) {
            saved.push({ el, originalVis: el.visibility });
            el.visibility = vis;
        }

        const HIDE_TYPES = new Set(['armature_bone', 'locator', 'null_object']);
        const GEO_TYPES  = new Set(['mesh', 'cube']);

        function processTree(children, insideArmature) {
            for (const el of (children || [])) {
                const t = (el.type || '').toLowerCase();

                if (t === 'armature') {
                    // Show armature container so its children are visible to codec
                    saveAndSet(el, true);
                    if (el.children)
                        processTree(el.children, true);
                } else if (HIDE_TYPES.has(t)) {
                    // Hide bone shapes, locators, null objects
                    saveAndSet(el, false);
                    if (el.children)
                        processTree(el.children, true);
                } else if (GEO_TYPES.has(t) && insideArmature) {
                    // Keep geometry at its original visibility — don't force
                    // hidden variants (face2, mouth2, etc.) to visible
                } else if (el.children) {
                    processTree(el.children, insideArmature);
                }
            }
        }

        processTree(Outliner.root, false);
        try { return await fn(); }
        finally {
            // Restore using direct references (OutlinerNode.uuidMap may not have armature types)
            for (const { el, originalVis } of saved)
                el.visibility = originalVis;
        }
    }

    // Build display transforms for the output JSON from export dialog fields.
    //
    // GUI and first-person-hand: the shader handles these with hardcoded
    // internal transforms (isGUI / isHand branches) — omit these slots.
    //
    // World slots (thirdperson, ground, head, fixed):
    //   Rotation  — orients the element quad; the shader's autorotate reads
    //               the quad corners to derive a rotation matrix.
    //   Translation — shifts the anchor point (corner 2).
    //   Scale — NOT included. The shader computes scale from quad geometry,
    //           so display scale would double with the export Scale field.
    //
    // Source priority:
    //   1. global `display` (native BlockBench Display editor — that's the
    //      variable BB exposes; `Project.display` may also exist but `display`
    //      is the working set BB writes into on every slot edit).
    //   2. cfg.displaySlots (our dialog's legacy per-slot fields).
    //
    // We DO NOT inject defaults — slots the user didn't customise are skipped
    // entirely, so Minecraft applies its built-in item defaults (which depend
    // on the model's parent). Pumping our own "sensible" values into every
    // slot was overriding vanilla rendering in unpredictable ways.

    // ── Issue #10: pure vanilla ItemTransform matrix ──────────────────────
    // Builds the column-major 4x4 a vanilla model.json display tag applies:
    //   M = T(translation/16) * R_xyz(rotation°) * S(scale)
    // about the MODEL ORIGIN (NO baked [8,8,8] pivot). Euler order is XYZ,
    // positive angles, no axis negation — identical for every slot. THREE-free
    // and pure so it is unit-testable; the dialog feeds the result straight
    // into new THREE.Matrix4().fromArray(arr).
    //
    // Column-major layout (THREE convention): m[col*4 + row]. To transform a
    // point p:  x' = m[0]*p.x + m[4]*p.y + m[8]*p.z + m[12], etc.
    function buildItemTransformMatrix(rotDeg, transUnits, scaleVec) {
        const r = rotDeg    || [0, 0, 0];
        const tr = transUnits || [0, 0, 0];
        const s = scaleVec  || [1, 1, 1];
        const D = Math.PI / 180;
        const cx = Math.cos(r[0] * D), sx = Math.sin(r[0] * D);
        const cy = Math.cos(r[1] * D), sy = Math.sin(r[1] * D);
        const cz = Math.cos(r[2] * D), sz = Math.sin(r[2] * D);

        // R = Rx * Ry * Rz (intrinsic XYZ, matching THREE.Euler 'XYZ').
        // Standard composed rotation matrix (row-major math below, packed
        // column-major at the end).
        const r00 = cy * cz;
        const r01 = -cy * sz;
        const r02 = sy;
        const r10 = sx * sy * cz + cx * sz;
        const r11 = -sx * sy * sz + cx * cz;
        const r12 = -sx * cy;
        const r20 = -cx * sy * cz + sx * sz;
        const r21 = cx * sy * sz + sx * cz;
        const r22 = cx * cy;

        // M = R * S  (scale columns), then translation in the last column.
        const sxv = s[0], syv = s[1], szv = s[2];
        const tx = tr[0] / 16, ty = tr[1] / 16, tz = tr[2] / 16;

        // Column-major: [c0(0..3), c1(4..7), c2(8..11), c3(12..15)]
        return [
            r00 * sxv, r10 * sxv, r20 * sxv, 0,
            r01 * syv, r11 * syv, r21 * syv, 0,
            r02 * szv, r12 * szv, r22 * szv, 0,
            tx,        ty,        tz,        1,
        ];
    }

    // ── Issue #10: map a display-tab id to its d* state-field prefix ───────
    // The dialog stores per-slot transforms as flat fields like dThirdRX /
    // dFprTY / dGuiSZ; callers append {R,T,S}{X,Y,Z} to this prefix. Kept
    // exported for display-matrix.test.mjs.
    function activeSlotPrefixFor(displayTab) {
        return ({
            third:  'dThird',
            fpr:    'dFpr',
            fpl:    'dFpl',
            head:   'dHead',
            gui:    'dGui',
            ground: 'dGround',
            fixed:  'dFixed',
            shelf:  'dShelf',
        })[displayTab] || 'dThird';
    }

    // ── display-1:1 step A1: static-display detection ─────────────────────
    // The shader's world branch (isHand+isGUI==0) applies an autorotate spin
    // the BB Display editor never shows. We GATE it: if ANY WORLD display slot
    // (thirdperson_*, head, ground, fixed, on_shelf — NOT gui / firstperson_*)
    // carries a non-identity rotation/translation/scale, the static display
    // wins and the shader skips autorotate. Returns true when such a slot
    // exists. Pure + exported so a byte test can drive it.
    function hasStaticWorldDisplay(cfg) {
        const WORLD_SLOTS = [
            'thirdperson_righthand','thirdperson_lefthand',
            'head','ground','fixed','on_shelf',
        ];
        const slots = (cfg && cfg.displaySlots) || {};
        const num = (v) => (Number.isFinite(+v) ? +v : 0);
        for (const key of WORLD_SLOTS) {
            const s = slots[key];
            if (!s) continue;
            const r = (s.rotation    || [0,0,0]).map(num);
            const t = (s.translation || [0,0,0]).map(num);
            const sc = (s.scale      || [1,1,1]).map(num);
            if (r.some(v => v !== 0)) return true;
            if (t.some(v => v !== 0)) return true;
            if (sc.some(v => v !== 1)) return true;
        }
        return false;
    }

    function buildDisplayTransforms(cfg) {
        const result = {};
        const ALL_SLOTS = [
            'thirdperson_righthand','thirdperson_lefthand',
            'firstperson_righthand','firstperson_lefthand',
            'head','gui','ground','fixed','on_shelf',
        ];
        // Per-axis depth (Z) display scale can't be reproduced in the hand/world/frame
        // slots: their transform is reconstructed from the flat 1-quad carrier, which
        // exposes only the X/Y in-plane edges (subgroupQuadBroadcast sees 4 coplanar
        // corners = 2 edges), so the perpendicular Z axis uses min(Sx,Sy). Exact for
        // uniform + X-only/Y-only stretch (Sz == min(Sx,Sy)); a different Sz is lost.
        // GUI is exact (its per-axis scale rides the header). Warn so the user isn't
        // mystified. See memory: display-z-depth-limit.
        const zLossySlots = [];

        const nativeDisplay = (typeof display !== 'undefined' && display) ||
                              (typeof Project !== 'undefined' && Project && Project.display) ||
                              null;
        const dialogSlots = cfg.displaySlots || {};

        for (const key of ALL_SLOTS) {
            // GUI: handled entirely by shader header (cfg.displaySlots.gui →
            // texture meta pixels t[8..12]). Model.json display.gui must stay
            // identity, otherwise MC applies the tag on top of shader transform.
            if (key === 'gui') continue;
            // Hands: per-slot model.json owns rotation/translation AND scale now.
            // Vanilla applies display.firstperson_* verbatim (step A2 revert);
            // the shader no longer packs/applies a hand scale.

            const nat = nativeDisplay && nativeDisplay[key];
            const dlg = dialogSlots[key];
            if (!nat && !dlg) continue;  // skip — let Minecraft use its default

            // Dialog values win over native editor. The plugin's dialog is
            // the user-facing source of truth; native editor was overriding
            // dialog values silently (legacy 85° values persisted in older
            // projects kept hijacking new defaults).
            const r = (dlg && dlg.rotation)    || (nat && nat.rotation)    || [0,0,0];
            const t = (dlg && dlg.translation) || (nat && nat.translation) || [0,0,0];
            const s = (dlg && dlg.scale)       || (nat && nat.scale)       || [1,1,1];

            const entry = {};
            if (r.some(v => v !== 0)) entry.rotation    = [...r];
            if (t.some(v => v !== 0)) entry.translation = [...t];
            if (s.some(v => v !== 1)) entry.scale       = [...s];
            if (Object.keys(entry).length) result[key] = entry;

            // Z is lossy iff the intended depth scale differs from min(Sx,Sy).
            if (Math.abs(s[2] - Math.min(s[0], s[1])) > 1e-4) zLossySlots.push(key);
        }

        // Item-only: armor is body-part mapped and doesn't use this display path.
        if (!cfg.exportAsEquipment && zLossySlots.length) {
            surfaceWarning(`Per-axis depth (Z) display scale on ${zLossySlots.join(', ')} can't be reproduced in hand/world/frame — the flat carrier exposes only X/Y, so Z falls back to min(Sx,Sy). GUI is exact. Use a uniform or X/Y-only display scale on these slots if depth matters.`);
        }

        return result;
    }

    // =========================================================
    // Section 8: Core Encode Pipeline
    // =========================================================
    async function buildOutput(cfg, objContents, mtlString) {
        // objContents: string[] — one OBJ per frame (already compiled/baked)
        if (!objContents || !objContents.length || !objContents[0])
            throw new Error('No OBJ content');

        const nframes   = objContents.length;

        // Determine texture(s): atlas if multiple textures referenced, else single
        let texData; // { data, width, height }
        let atlasInfo = null; // null = single texture, otherwise atlas UV remap info

        // Map material names → Texture.all indices
        // Try MTL file first, then fall back to BB's m_UUID convention
        const materialToTexIdx = new Map();
        const mtlMap = parseMtl(mtlString);
        if (mtlMap.size > 0) {
            for (const [k, v] of buildMaterialToTexMap(mtlMap)) materialToTexIdx.set(k, v);
        }
        if (materialToTexIdx.size === 0) {
            // BB OBJ uses "usemtl m_<texture-uuid>" — match directly
            for (const obj of objContents) {
                for (const line of obj.split('\n')) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('usemtl ')) {
                        const mtlName = trimmed.slice(7).trim();
                        if (materialToTexIdx.has(mtlName)) continue;
                        if (mtlName.startsWith('m_')) {
                            const uuid = mtlName.slice(2);
                            const idx = Texture.all.findIndex(t => t.uuid === uuid);
                            if (idx >= 0) materialToTexIdx.set(mtlName, idx);
                        }
                    }
                }
            }
        }
        let referencedTexIndices = new Set(materialToTexIdx.values());
        // Filter to only user-selected textures
        if (cfg.useAtlas && cfg.atlasTexIndices) {
            const allowed = new Set(cfg.atlasTexIndices);
            referencedTexIndices = new Set([...referencedTexIndices].filter(i => allowed.has(i)));
        }

        let atlasAnim = null;   // { y0, frameH, frameCount } for an animated strip inside the atlas
        if (cfg.useAtlas && referencedTexIndices.size > 1) {
            // Multi-texture: build atlas
            const atlas = await buildAtlas([...referencedTexIndices]);
            texData = { data: atlas.data, width: atlas.width, height: atlas.height };
            atlasInfo = {
                materialToTexIdx,
                offsets: atlas.offsets,
                width: atlas.width,
                height: atlas.height,
            };
            // Atlas texture animation: one of the atlas textures may itself be a
            // vertical frame strip (h = N*w). Animate just that region; the rest
            // stay static. The strip is stored whole; faces on it UV-map to frame 0
            // (see remapUV) and the shader cycles the sampled row within its band.
            if (cfg.texAnimEnabled) {
                // Frame height: the texture's BB uv_height when it slices the
                // image evenly (BB-animated texture), else square frames (h=N*w).
                const frameHOf = (o) => {
                    if (o.uvh && o.uvh < o.h && o.h % o.uvh === 0) return o.uvh;
                    return o.w;
                };
                const strips = [...referencedTexIndices].filter(i => {
                    const o = atlas.offsets.get(i);
                    if (!o) return false;
                    const fh = frameHOf(o);
                    return fh < o.h && o.h % fh === 0;
                });
                if (strips.length === 0) {
                    surfaceWarning('texture animation is on, but none of the atlas textures is a frame strip (animated in Blockbench, or height a whole multiple ≥2× of width). Nothing will animate.');
                } else {
                    if (strips.length > 1)
                        surfaceWarning(`the atlas has ${strips.length} frame-strip textures; only the first will animate (one animated strip per atlas is supported).`);
                    const o = atlas.offsets.get(strips[0]);
                    const frameH = frameHOf(o);
                    const frameCount = o.h / frameH;
                    if (frameCount > 255)
                        throw new Error(`Animated atlas texture has ${frameCount} frames; the maximum is 255.`);
                    // The atlas stores each texture V-FLIPPED whole-region, so
                    // image frame 0 (the TOP frame, which the model UV-maps to)
                    // lands at the BOTTOM of the strip region. Encode THAT band;
                    // the shader steps UPWARD (negative row offset) per frame.
                    atlasAnim = { y0: o.y + o.h - frameH, frameH, frameCount };
                }
            }
        } else {
            // Single texture (original path)
            const bbTex = Texture.all[cfg.texIndex];
            if (!bbTex) throw new Error(`No texture at index ${cfg.texIndex}`);
            texData = await getTextureRGBA(bbTex);
        }

        const tw = texData.width, th = texData.height;
        if (tw < 8) throw new Error('Minimum texture size is 8px wide');
        // The row-0 header writes the GUI transform into columns 8..15, so a
        // texture narrower than 16px cannot encode it (icon scale/rot/pivot read
        // as 0 -> invisible/wrong inventory icon). The model itself still decodes.
        if (tw < 16) surfaceWarning(`texture is only ${tw}px wide — the inventory (GUI) icon transform needs a ≥16px-wide texture and will be wrong/invisible. Widen the texture if you use the GUI slot.`);
        if (tw > 65535 || th > 65535) throw new Error(`Texture too large: ${tw}x${th} (max 65535)`);

        // Animated textures (issue #9): a vertically-stacked strip of square
        // frames bakes into ntextures stacked texture regions. The header's
        // size.y encodes ONE frame's height (frameH); the shader reserves
        // size.y*ntextures rows and steps the sampled row by texframe*size.y.
        // frameCount is derived from the strip aspect (square frames: th/tw).
        // Whole-texture animation (single-texture path): ntextures stacked frame
        // regions. Atlas animation is handled separately above (atlasAnim), so
        // ntextures stays 1 for the atlas — its animated band is a sub-region.
        let ntextures = 1, frameH = th;
        if (cfg.texAnimEnabled && !atlasInfo) {
            const frameCount = Math.round(th / tw);
            if (th % tw !== 0 || frameCount < 1)
                throw new Error(`Animated texture strip must be a vertical stack of square frames: height ${th} is not a whole multiple of width ${tw}.`);
            if (frameCount > 255)
                throw new Error(`Animated texture has ${frameCount} frames; the maximum is 255 (the frame count is stored in a single byte). Use fewer/taller frames.`);
            if (frameCount > 1) { ntextures = frameCount; frameH = th / ntextures; }
        }
        // Texture clock: how many ticks each frame holds (>=1), and whether
        // frames cross-fade (item/GUI only) or hard-step.
        const texFrametime = Math.max(1, Math.round(cfg.texFrametime || 1));
        const texFade = !!cfg.texFade;

        // Armor only: re-center each part's geometry on its own anchor so the
        // calibrated AOFF (measured at BB origin) holds wherever the artist places a
        // part. Item/GUI exports keep their absolute placement (display handles it).
        let faceToPart = null, partRef = null;
        if (cfg.exportAsEquipment) {
            const f0 = parseObj(objContents[0], 0);
            faceToPart = (Array.isArray(cfg.selectedPieces) && cfg.selectedPieces.length)
                ? buildFaceToPart(f0.faceGroups, f0.faceBlocks) // per-piece: each face -> its part
                : f0.faces.map(() => 0);                        // legacy single-part: whole model as one unit
            partRef = computePartCenters(f0, faceToPart);
        }
        const { data, nfaces, faceGroups, faceBlocks, uvClamped } = buildVertexData(objContents, atlasInfo, partRef, faceToPart);
        const emissiveMap = collectEmissiveMap();
        const faceEmission = faceGroups.map(g => {
            const tk = parseFaceToken(g);                 // armor: emissive baked into the token
            return tk ? tk.emis : (emissiveMap.get((g || '').toLowerCase()) || 0);
        });
        if (nfaces === 0) throw new Error('No faces found in OBJ');
        const nvertices = nfaces * 4;

        const uvH  = Math.ceil(nfaces / tw);
        const texH = th;
        const vpH  = Math.ceil(data.positions.length * 3 / tw);
        const vtH  = Math.ceil(data.uvs.length * 2 / tw);
        const vH   = Math.ceil(data.vertices.length * 2 / tw); // includes all frames

        // --- Encoder safety guards: fail loudly instead of silently corrupting the PNG ---
        const BYTE24_MAX = 16777215; // u24() holds 0..2^24-1; larger values wrap mod 2^24
        if (!Number.isFinite(cfg.scale))
            throw new Error(`Scale is not a finite number (got ${cfg.scale}).`);
        // No scale UI input; a legacy/corrupt non-positive scale would silently collapse
        // the model. Coerce to 1 (the default) rather than block export with a dead-end.
        if (cfg.scale <= 0) cfg.scale = 1;
        if (!Array.isArray(cfg.offset) || !cfg.offset.every(Number.isFinite))
            throw new Error(`Offset X/Y/Z must be finite numbers (got ${cfg.offset && cfg.offset.join(', ')}).`);
        // Position codec: byte24 = 8388608 + v_world*65536, decodable only in [-128, +128).
        // (Y check includes the -0.5 block-centre re-anchor baked at write time.)
        for (let pi = 0; pi < data.positions.length; pi++) {
            const p = data.positions[pi];
            for (let a = 0; a < 3; a++) {
                const w = p[a] * cfg.scale + cfg.offset[a] - (a === 1 ? 0.5 : 0);
                if (!Number.isFinite(w))
                    throw new Error(`Vertex coordinate became NaN/Infinity — check Scale/Offset.`);
                if (w < -128 || w >= 128)
                    throw new Error(`Model out of range: a vertex reaches ${w.toFixed(2)} on axis ${'XYZ'[a]}; must stay within [-128, 128) after scale+offset. Lower Scale or shrink the model.`);
            }
        }
        // Vertex/UV indices are stored as 24-bit values (u24) — must not exceed the limit.
        if (data.positions.length > BYTE24_MAX)
            throw new Error(`Too many unique positions (${data.positions.length} > ${BYTE24_MAX}) for a 24-bit index — use fewer animation frames or a lower-poly model.`);
        if (data.uvs.length > BYTE24_MAX)
            throw new Error(`Too many unique UVs (${data.uvs.length} > ${BYTE24_MAX}) for a 24-bit index.`);
        // Header packs vpH/vtH as 16-bit (th is already checked above).
        if (vpH > 65535 || vtH > 65535)
            throw new Error(`Encoded data section too tall (positions ${vpH}, uvs ${vtH} rows; max 65535) — use a wider texture or fewer frames.`);

        const headerRows = 2;
        let ty = headerRows + uvH + texH + vpH + vtH + vH;
        if (!cfg.nopow) ty = 1 << Math.ceil(Math.log2(ty || 1));


        const cbArr = ['direct','time','scale','overlay','hurt'];
        const ca = cfg.colorbehavior.map(x => {
            const idx = cbArr.indexOf(x);
            if (idx < 0) throw new Error('Unknown colorbehavior: ' + x);
            return idx;
        });
        const cb  = (ca[0]<<6)|(ca[1]<<3)|ca[2];
        const dur = cfg.duration === 0 ? nframes : cfg.duration;

        const buf = new Uint8Array(tw * ty * 4);
        const put = (x, y, r, g, b, a=255) => {
            // Bounds-check: an out-of-range x must NEVER wrap into the next row.
            // The row-0 header writes columns up to x=15 (GUI block); on a narrow
            // texture those would silently clobber row 1 (the anim clock). Skip
            // instead — callers that need the columns guard tw upstream.
            if (x < 0 || x >= tw || y < 0 || y >= ty) return;
            const i = (y*tw + x)*4;
            buf[i]=r&255; buf[i+1]=g&255; buf[i+2]=b&255; buf[i+3]=a&255;
        };
        // 16-bit quantizer for every GUI field (display-1:1 step B: scale/trans/
        // rot/pivot all q16 now). Every header pixel must keep A=255 to survive
        // MC's alpha pre-multiplication on GUI item-icon rendering, so only RGB
        // (3 bytes) per pixel carry data; 2 bytes/axis -> 2 pixels per xyz triple.
        // Returns [highByte, lowByte]; A is locked at 255 by the put() callers.
        const q16 = (v, min, max) => {
            const c = Math.max(min, Math.min(max, v));
            const u = Math.round((c - min) / (max - min) * 65535);
            return [(u >> 8) & 255, u & 255];
        };

        // GUI shader parameters at q16 (display-1:1 step B). Each axis is 2 bytes
        // (high,low); scale 0..4, translation -128..+128 (1/16-block, vanilla),
        // rotation 0..360°, pivot -128..+128 (model origin). q16 epsilon:
        // scale 6.1e-5, trans/pivot 3.9e-3, rot 5.5e-3° — far below vanilla need.
        const guiSlot = (cfg.displaySlots && cfg.displaySlots.gui) || {};
        const fallback = (v, def) => Number.isFinite(v) ? v : def;
        // GUI scale 0 (or NaN/blank) is never legitimate — it makes the icon invisible.
        // Treat any non-positive or non-finite value as 1 (identity scale).
        const guiS = (guiSlot.scale || [1,1,1]).map(v => (Number.isFinite(v) && v > 0) ? v : 1);
        const guiT = (guiSlot.translation || [0,0,0]).map(v => fallback(v, 0));
        const guiR = (guiSlot.rotation    || [0,0,0]).map(v => {
            const d = fallback(v, 0);
            return ((d % 360) + 360) % 360;
        });
        // GUI rotation pivot defaults to the BLOCK CENTRE — which in the decoded
        // frame is the ORIGIN [0,0,0] (the decoded model is block-centre relative;
        // in-game verified via the lift-0 hand/world slots matching vanilla). That
        // is the pivot vanilla display uses, so a rotated GUI icon lands where the
        // same vanilla model's icon does. (The old default was the model's bbox
        // centre — "visually centred" but off vanilla under rotation/scale.)
        // A user-set pivot still overrides, e.g. to rotate about the model centre.
        const offArr = Array.isArray(cfg.offset) ? cfg.offset : [0,0,0];
        const userPivot = guiSlot.pivot || [0,0,0];
        const hasUserPivot = userPivot.some(v => v !== 0);
        const guiP = hasUserPivot
            ? userPivot.map((v, i) => v * (+cfg.scale || 1) + (+offArr[i] || 0))
            : [0, 0, 0];
        const staticDisplay = hasStaticWorldDisplay(cfg);
        const [sxH, sxL] = q16(guiS[0], 0, 4),    [syH, syL] = q16(guiS[1], 0, 4),    [szH, szL] = q16(guiS[2], 0, 4);
        const [txH, txL] = q16(guiT[0], -128, 128), [tyH, tyL] = q16(guiT[1], -128, 128), [tzH, tzL] = q16(guiT[2], -128, 128);
        const [rxH, rxL] = q16(guiR[0], 0, 360),  [ryH, ryL] = q16(guiR[1], 0, 360),  [rzH, rzL] = q16(guiR[2], 0, 360);
        // q16 silently clamps to [-128,128); a large/offset model can push the GUI
        // rotation pivot past that, shifting the icon's rotation centre — warn first.
        if (guiP.some(v => v < -128 || v >= 128))
            surfaceWarning(`GUI rotation pivot (${guiP.map(v => v.toFixed(1)).join(', ')}) is outside [-128, 128) and was clamped — the inventory icon will spin about a shifted point. Lower Scale or move the model toward the origin.`);
        const [pxH, pxL] = q16(guiP[0], -128, 128);
        const [pyH, pyL] = q16(guiP[1], -128, 128);
        const [pzH, pzL] = q16(guiP[2], -128, 128);

        // Row 0 — header. marker.a=255 (alpha=255 prevents GUI alpha-premultiplication
        // from corrupting RGB; legacy marker.a=78 broke GUI rendering for this reason).
        put(0, 0, 12, 34, 56, 255);
        put(1, 0, Math.trunc(tw/256), tw%256, Math.trunc(frameH/256), 255);
        put(2, 0, Math.trunc(nvertices/16777216)%256, Math.trunc(nvertices/65536)%256,
                  Math.trunc(nvertices/256)%256, 255);
        put(3, 0, Math.trunc(nframes/65536)%256, Math.trunc(nframes/256)%256,
                  nframes%256, ntextures);
        put(4, 0, Math.trunc(dur/65536)%256, Math.trunc(dur/256)%256, dur%256,
                  128|(cfg.autoplay?64:0)|(cfg.easing<<4)|(cfg.interpolation<<2));
        put(5, 0, Math.trunc(vpH/256)%256, vpH%256, Math.trunc(vtH/256)%256, 255);
        // t[6].r bits: 7=noshadow, 6..5=autorotate, 4..2=visibility,
        //   1=hasStaticDisplay (step A1 gate), 0=colorbehavior high bit.
        // t[6].b = GUI header version (display-1:1 step B): 2 = q16 GUI layout in
        // t[8..15]. The shader gates its GUI decode on this so a stale PNG (older
        // encoder wrote 255 here) cannot desync from the q16 decode. A stays 255.
        put(6, 0,
            ((cfg.noshadow?1:0)<<7)|(cfg.autorotate<<5)|(cfg.visibility<<2)|((staticDisplay?1:0)<<1)|Math.trunc(cb/256),
            cb%256, 2, 255);
        put(7, 0, frameH%256, nvertices%256, vtH%256, 255);
        // GUI shader meta at q16 (display-1:1 step B): 8 pixels, 2 bytes/axis
        // (high,low) for scale/trans/rot/pivot. All A=255 for premultiplication
        // safety. Layout MUST match the shader decode (objmc_main.glsl GUI block):
        //   t[8]=(sxH,sxL,syH) t[9]=(syL,szH,szL)  scale  0..4
        //   t[10]=(txH,txL,tyH) t[11]=(tyL,tzH,tzL) trans -128..128 (1/16-block)
        //   t[12]=(rxH,rxL,ryH) t[13]=(ryL,rzH,rzL) rot   0..360 deg
        //   t[14]=(pxH,pxL,pyH) t[15]=(pyL,pzH,pzL) pivot -128..128 (origin)
        put(8,  0, sxH, sxL, syH, 255);
        put(9,  0, syL, szH, szL, 255);
        put(10, 0, txH, txL, tyH, 255);
        put(11, 0, tyL, tzH, tzL, 255);
        put(12, 0, rxH, rxL, ryH, 255);
        put(13, 0, ryL, rzH, rzL, 255);
        put(14, 0, pxH, pxL, pyH, 255);
        put(15, 0, pyL, pzH, pzL, 255);
        // Row 1: hand rotation/translation writes removed (step A2 revert) —
        // vanilla model.json owns the full hand transform now. Row 1 stays
        // zeroed except the issue-#9 texture clock below.
        for (let i = 0; i < tw; i++) put(i, 1, 0, 0, 0, 255);  // init with zeros
        // Texture-animation clock (issue #9), stored in previously-zeroed row-1
        // pixels. x=4 RGB = texFrametime (24-bit ticks per frame); x=5.r = fade
        // flag. The shader fetches these from row 1 via texelFetch(topleft+(x,1)).
        // Only written when ntextures>1 so a non-animated export stays byte-for-
        // byte identical to the pre-#9 encoder (these pixels remain zeroed).
        if (ntextures > 1) {
            put(4, 1, Math.trunc(texFrametime/65536)%256, Math.trunc(texFrametime/256)%256,
                      texFrametime%256, 255);
            put(5, 1, texFade ? 1 : 0, 0, 0, 255);
        }
        // Atlas texture-animation band (mutually exclusive with ntextures>1). The
        // shader's atlas sampling path (ntextures==1) reads x=5.g as the enable
        // flag, then the frametime + band bounds. Layout:
        //   x=4 RGB = frametime (24-bit)          x=5.r = fade, x=5.g = enable
        //   x=6 = (y0>>8, y0&255, frameH>>8)      x=7 = (frameH&255, frameCount, -)
        if (atlasAnim) {
            const { y0, frameH: aFrameH, frameCount } = atlasAnim;
            put(4, 1, Math.trunc(texFrametime/65536)%256, Math.trunc(texFrametime/256)%256,
                      texFrametime%256, 255);
            put(5, 1, texFade ? 1 : 0, 1, 0, 255);
            put(6, 1, Math.trunc(y0/256)%256, y0%256, Math.trunc(aFrameH/256)%256, 255);
            put(7, 1, aFrameH%256, frameCount%256, 0, 255);
        }

        // UV header + JSON elements
        const elements = [];
        for (let i = 0; i < nfaces; i++) {
            const px = i%tw, py = Math.floor(i/tw)+headerRows;
            put(px, py, Math.trunc(px/256)%256, px%256, Math.trunc(py/256)%256, py%256);
            const elem = {
                // Carrier anchor = FaceBakery NORTH c2 = MIN corner = (8,8,8) px = block
                // centre (0.5,0.5,0.5). The shader anchors the centred decoded model AT c2,
                // so c2 must be the cube CENTRE, not the cube bottom. Was [8,0,8] (MIN_Y=0 =
                // bottom) which dropped every model 0.5 block (8px) low — verified by
                // tools/render-tester (IoU 0.47 -> 0.998 after this shift). +Y edge stays
                // 16px (8..24) so display scale/rotation reconstruction is unchanged.
                from: [8,8,8], to: [24,24,8],
                faces: { north: {
                    uv: [(px+0.1)*16/tw,(py+0.1)*16/ty,(px+0.9)*16/tw,(py+0.9)*16/ty],
                    texture: '#0', tintindex: 0,
                }},
            };
            if (faceEmission[i] > 0) elem.light_emission = faceEmission[i];
            elements.push(elem);
        }

        // Texture rows
        if (atlasInfo) {
            // Atlas: flip each texture independently within its region
            for (const [, off] of atlasInfo.offsets) {
                for (let ly = 0; ly < off.h; ly++) {
                    const srcLy = cfg.flipuv ? ly : (off.h - 1 - ly);
                    const srcRow = off.y + srcLy;
                    const dstRow = (headerRows + uvH) + off.y + ly;
                    for (let px = 0; px < off.w; px++) {
                        const si = (srcRow * tw + px) * 4;
                        put(px, dstRow, texData.data[si], texData.data[si+1],
                            texData.data[si+2], texData.data[si+3]);
                    }
                }
            }
        } else if (ntextures > 1) {
            // Animated strip: flip each frame region INDEPENDENTLY so frame
            // ORDER is preserved (a whole-strip flip would reverse the order).
            // The full strip stays physically stored as frameH*ntextures rows.
            for (let f = 0; f < ntextures; f++) {
                const fbase = f * frameH; // top row of this frame in src & dst
                for (let ly = 0; ly < frameH; ly++) {
                    const srcY = fbase + (cfg.flipuv ? ly : (frameH-1-ly));
                    const dstY = (headerRows+uvH) + fbase + ly;
                    for (let px = 0; px < tw; px++) {
                        const si = (srcY*tw+px)*4;
                        put(px, dstY, texData.data[si], texData.data[si+1],
                            texData.data[si+2], texData.data[si+3]);
                    }
                }
            }
        } else {
            // Single texture: global flip
            for (let py = 0; py < th; py++) {
                const srcY = cfg.flipuv ? py : (th-1-py);
                for (let px = 0; px < tw; px++) {
                    const si = (srcY*tw+px)*4;
                    put(px, (headerRows+uvH)+py, texData.data[si], texData.data[si+1],
                        texData.data[si+2], texData.data[si+3]);
                }
            }
        }

        // Position data
        let ybase = headerRows+uvH+texH;
        // VERTICAL ORIGIN CONVENTION: the decoded frame is BLOCK-CENTRE relative
        // (the carrier anchor c2 sits at the block centre and every display path
        // adds decoded positions to it as-is). Blockbench models are naturally
        // built ON the grid floor (y=0 = block bottom, like a vanilla JSON model
        // 0..16), so bake Y - 0.5 here — then the model lands in game exactly
        // where it stands relative to the BB grid, in EVERY context (GUI, hands,
        // frames, ground) at once. Without this, a floor-built model rides half
        // a block high everywhere (a centre-built model used to hide it, which
        // is how the old per-slot lifts got mis-calibrated per model).
        // Applied to ALL exports, equipment included, so the ITEM view of an
        // armor export is correct in EVERY display slot (an element-shift
        // compensation only worked at identity display — the shifted anchor
        // rotates with the display). The armor shader path adds the +0.5 back in
        // the SAME decoded model frame (before its part re-anchoring/rotation),
        // so armor on entities is byte-equivalent to the pre-convention state.
        const bakeOffset = [cfg.offset[0], cfg.offset[1] - 0.5, cfg.offset[2]];
        for (let i = 0; i < data.positions.length; i++) {
            for (const [j, pxArr] of posPixels(data.positions[i], cfg.scale, bakeOffset).entries()) {
                const p = i*3+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // UV data
        ybase += vpH;
        if (uvClamped || data.uvs.some(uv => uv.some(v => v < -1e-6 || v > 1 + 1e-6)))
            surfaceWarning('some UVs fall outside the 0..1 frame (tiling/negative) and were clamped — those faces may look wrong. Keep the model UV-mapped inside the texture frame.');
        for (let i = 0; i < data.uvs.length; i++) {
            for (const [j, pxArr] of uvPixels(data.uvs[i]).entries()) {
                const p = i*2+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // Vertex data (all frames)
        ybase += vtH;
        for (let i = 0; i < data.vertices.length; i++) {
            const pixels = vertPixels(data.vertices[i]);
            for (const [j, pxArr] of pixels.entries()) {
                const p = i*2+j;
                put(p%tw, ybase+Math.floor(p/tw), ...pxArr);
            }
        }

        // Round-trip verification: decode a few entries from the buffer
        // using the same logic the shader uses, and compare with source data.
        const verifyWarns = [];
        try {
            const rd = (x, y) => {
                const i = (y*tw+x)*4;
                return [buf[i], buf[i+1], buf[i+2], buf[i+3]];
            };
            // Layout diagnostic
            console.log('[obj3-layout] headerRows='+headerRows, 'uvH='+uvH, 'texH='+texH,
                'vpH='+vpH, 'vtH='+vtH, 'vH='+vH, 'ty='+ty, 'tw='+tw);
            console.log('[obj3-layout] row0[0]=', rd(0,0), 'row1[0]=', rd(0,1),
                'uvStart[0]=', rd(0,headerRows), 'posStart[0]=', rd(0,headerRows+uvH+texH));
            // Verify marker
            const mk = rd(0, 0);
            if (mk[0]!==12||mk[1]!==34||mk[2]!==56||mk[3]!==255) {
                verifyWarns.push('marker mismatch');
                console.error('[obj3-verify] MARKER MISMATCH:', mk);
            }
            // Verify header: nvertices, nframes
            const h2 = rd(2, 0), h7 = rd(7, 0);
            const decNv = h2[0]*16777216+h2[1]*65536+h2[2]*256+h7[1];
            const h3 = rd(3, 0);
            const decNf = Math.max(h3[0]*65536+h3[1]*256+h3[2], 1);
            if (decNv !== nvertices) { verifyWarns.push('nvertices mismatch'); console.error(`[obj3-verify] nvertices: encoded=${decNv} expected=${nvertices}`); }
            if (decNf !== nframes)   { verifyWarns.push('nframes mismatch');   console.error(`[obj3-verify] nframes: encoded=${decNf} expected=${nframes}`); }
            // Verify first position (shader decodes as v*scale+offset)
            const posBase = headerRows + uvH + texH;
            const px0 = rd(0, posBase), px1 = rd(1, posBase), px2 = rd(2, posBase);
            const decPos = [
                (px0[0]/255*256 + px0[1]/255 + px0[2]/255/256) * (255/256) - 128,
                (px1[0]/255*256 + px1[1]/255 + px1[2]/255/256) * (255/256) - 128,
                (px2[0]/255*256 + px2[1]/255 + px2[2]/255/256) * (255/256) - 128,
            ];
            const srcPos = data.positions[0];
            // Expected = what the encoder actually baked (incl. the -0.5 Y
            // block-centre re-anchor for non-armor exports).
            const expPos = srcPos.map((v,j) => v * cfg.scale + bakeOffset[j]);
            const posDiff = Math.abs(decPos[0]-expPos[0])+Math.abs(decPos[1]-expPos[1])+Math.abs(decPos[2]-expPos[2]);
            if (posDiff > 0.01) { verifyWarns.push('pos[0] mismatch'); console.error(`[obj3-verify] pos[0] MISMATCH: exp=[${expPos.map(v=>v.toFixed(4))}] dec=[${decPos.map(v=>v.toFixed(4))}]`); }
            // Verify first UV coordinate (uvPixels writes u24(clamp(v)*65535) at the
            // UV-float section base; mirror the encoder's write base + the shader's
            // /65535 read). Catches a regression in the clamp / scaling math.
            const uvBase = headerRows + uvH + texH + vpH;
            const uv0u = rd(0, uvBase), uv0v = rd(1, uvBase);
            const decUv = [
                (uv0u[0]*65536 + uv0u[1]*256 + uv0u[2]) / 65535,
                (uv0v[0]*65536 + uv0v[1]*256 + uv0v[2]) / 65535,
            ];
            const srcUv = data.uvs[0];
            if (srcUv) {
                const expUv = srcUv.map(v => Math.max(0, Math.min(1, v)));
                const uvEps = 2/65535;
                if (Math.abs(decUv[0]-expUv[0]) > uvEps || Math.abs(decUv[1]-expUv[1]) > uvEps) {
                    verifyWarns.push('uv[0] value mismatch');
                    console.error(`[obj3-verify] uv[0] MISMATCH: exp=[${expUv.map(v=>v.toFixed(5))}] dec=[${decUv.map(v=>v.toFixed(5))}]`);
                }
            }
            // Verify first vertex data entry
            const vtxBase = headerRows + uvH + texH + vpH + vtH;
            const va = rd(0, vtxBase), vb = rd(1, vtxBase);
            const decPi = va[0]*65536+va[1]*256+va[2];
            const decUi = vb[0]*65536+vb[1]*256+vb[2];
            const srcVert = data.vertices[0];
            if (decPi !== srcVert[0]) { verifyWarns.push('vert[0].pos mismatch'); console.error(`[obj3-verify] vert[0].pos: encoded=${decPi} expected=${srcVert[0]}`); }
            if (decUi !== srcVert[1]) { verifyWarns.push('vert[0].uv mismatch');  console.error(`[obj3-verify] vert[0].uv: encoded=${decUi} expected=${srcVert[1]}`); }
            // Verify last frame's first vertex
            if (nframes > 1) {
                const lastIdx = (nframes-1) * nvertices;
                const lp = lastIdx * 2;
                const la = rd(lp%tw, vtxBase+Math.floor(lp/tw));
                const decLPi = la[0]*65536+la[1]*256+la[2];
                const srcLast = data.vertices[lastIdx];
                if (srcLast) {
                    if (decLPi !== srcLast[0]) { verifyWarns.push('last frame mismatch'); console.error(`[obj3-verify] vert[${lastIdx}].pos: enc=${decLPi} exp=${srcLast[0]}`); }
                }
            }
        } catch(e) { verifyWarns.push('verify error'); console.error('[obj3-verify] error:', e.message); }

        // Block a corrupt export: any hard integrity mismatch (marker / counts /
        // position / vertex data) means the shader would decode garbage, so abort
        // visibly instead of writing a broken PNG. ('verify error' = an exception
        // inside the verifier itself, kept as a soft warning.)
        const hardFails = verifyWarns.filter(w => w !== 'verify error');
        if (hardFails.length) {
            throw new Error('Integrity check failed (' + hardFails.join('; ') + ') — export aborted to avoid a corrupt model; see console for details.');
        }

        const pngBuffer = encodePNG(tw, ty, buf);
        const warnStr = verifyWarns.length
            ? t('warn_suffix').replace('{n}', verifyWarns.length).replace('{w}', tPlural(verifyWarns.length, 'warnings'))
            : '';
        const debugInfo = `${nfaces} ${tPlural(nfaces, 'faces')} · ${nframes} ${tPlural(nframes, 'frames')} · ${tw}×${ty}px` + warnStr;

        return { pngBuffer, rawBuf: buf, elements, nfaces, nvertices, nframes, tw, ty, debugInfo, faceGroups, faceBlocks, faceToPart, faceEmission };
    }

    // =========================================================
    // Section 9: Export Orchestration
    // =========================================================

    // Get OBJ contents (static or animated).
    // If the user has the BB Display tab open, Codecs.obj.compile() would apply
    // that slot's transforms (scale/rotation) to the exported geometry. The same
    // trap exists for the ANIMATE tab: with an animation selected and the
    // Timeline scrubbed, the scene is POSED and a static export bakes that pose
    // (group keyframe transforms ride BB's OBJ compiler) — the whole model
    // exported shifted until the user happened to leave Animate mode.
    // Switch to Edit mode first to ensure unaffected rest-pose geometry.
    // (The ANIMATED branch is exempt: it drives Timeline/Animator.preview()
    // itself per frame and restores the scene in its own finally.)
    async function getObjContents(cfg, onProgress) {
        const prevMode  = typeof Mode !== 'undefined' && Mode.selected;
        const inDisplay = prevMode && prevMode.id === 'display';
        const inAnimate = prevMode && prevMode.id === 'animate' && !cfg.animationEnabled;
        if ((inDisplay || inAnimate) && Modes && Modes.options && Modes.options.edit) {
            Modes.options.edit.select();
        }
        // Armor: rename elements to part-encoding tokens so each face's part is read
        // from its OWN element (codec emit order != Outliner walk for nested groups/
        // meshes, which scrambled body<->arm). Restored in finally.
        const restoreNames = cfg.exportAsEquipment ? applyPartTokenNames() : null;
        try {
            if (cfg.animationEnabled) {
                const anim = Animation.all[cfg.animationIndex];
                if (!anim) throw new Error('Animation not found');
                return await compileAnimatedObjFrames(anim, {
                    fps:        cfg.animFps,
                    frameStart: cfg.animStart,
                    frameEnd:   cfg.animEnd > 0 ? cfg.animEnd : anim.length,
                    filterArmature: cfg.filterArmature,
                    onProgress,
                });
            } else {
                const compile = () => Codecs.obj.compile();
                const safeCompile = () => withNonGeoHidden(compile);
                const boneUUIDs = collectBoneUUIDs();
                const hasArm = boneUUIDs.size > 0;
                const c = hasArm ? await withArmatureHidden(safeCompile) : await safeCompile();
                const raw = typeof c === 'string' ? c : (c.obj || '');
                const mtl = (typeof c === 'object' && c.mtl) ? c.mtl : '';
                if (!raw) throw new Error('OBJ codec returned empty content');
                let s = raw;
                if (hasArm) {
                    s = filterObjBones(s, boneUUIDs);
                }
                return { objs: [s], mtl };
            }
        } finally {
            if (restoreNames) restoreNames();
            if (inDisplay && Modes && Modes.options && Modes.options.display) {
                Modes.options.display.select();
            }
            if (inAnimate && Modes && Modes.options && Modes.options.animate) {
                try { Modes.options.animate.select(); } catch (e) {}
            }
        }
    }

    // Main export entry point
    async function runExport(cfg, onStatus) {
        const displayTransforms = buildDisplayTransforms(cfg);

        onStatus(t('status_building'));
        const { objs, mtl } = await getObjContents(cfg, (i, n) =>
            onStatus(t('status_baking').replace('{i}', i).replace('{n}', n))
        );
        const result = await buildOutput(cfg, objs, mtl);
        onStatus(t('status_choose_location').replace('{info}', result.debugInfo));
        await saveSingleOutput(result, displayTransforms, cfg);
        onStatus(t('export_done').replace('{info}', result.debugInfo));
    }

    // =========================================================
    // Section 10: File Saving
    // =========================================================
    // Display contexts Minecraft items use, in the order we emit them.
    // Each gets its own model.json with per-slot placeholder calibration
    // (empirically determined via debug-mode measurements vs vanilla JSON
    // cube reference).
    const DISPLAY_SLOTS = [
        'thirdperson_righthand', 'thirdperson_lefthand',
        'firstperson_righthand', 'firstperson_lefthand',
        'head', 'gui', 'ground', 'fixed', 'on_shelf',
    ];
    // Single source of truth for the export namespace. All exported assets live
    // under assets/<EXPORT_NS>/ and are referenced as <EXPORT_NS>:item/<name>.
    const EXPORT_NS = 'objc_cubed';
    // Per-slot placeholder calibration. Adjusts the `from`/`to` of every
    // element by these BB-unit deltas. Values measured against a reference
    // vanilla JSON cube placed at the same OBJ coordinates.
    const SLOT_OFFSETS = {
        thirdperson_righthand: { x: 0, y: 0,  z: 0 },
        thirdperson_lefthand:  { x: 0, y: 0,  z: 0 },
        firstperson_righthand: { x: 0, y: 0,   z: 0  },
        firstperson_lefthand:  { x: 0, y: 0,   z: 0  },
        head:                  { x: 0, y: 0,   z: 0  },
        gui:                   { x: 0, y: 0, z: 0 },
        // ground/on_shelf: +8 raises the carrier elements (and thus the anchor c2)
        // half a block. In-game: with everything else vanilla-exact at lift 0,
        // dropped items still sat half a block LOW — the dropped-item pipeline
        // positions the model half a block higher than the held/framed one.
        // The shift rides the carrier bake, so it holds under any display R*S.
        ground:                { x: 0, y: 8,  z: 0 },
        fixed:                 { x: 0, y: 0,  z: 0 },
        on_shelf:              { x: 0, y: 8, z: 0 },
    };

    // Slots whose carrier faces bake their U range OFF-CENTRE within the
    // face-id texel: normal faces span (px+0.1 .. px+0.9), U midpoint px+0.5;
    // marked faces span (px+0.35 .. px+0.95), U midpoint px+0.65. This is a
    // SLOT MARKER the shader world path reads back via fract of the quad's U
    // MIDPOINT — the midpoint survives MC's anti-bleed UV shrink (which
    // contracts UVs SYMMETRICALLY toward the quad centre; the previous
    // absolute-margin marker read fract(UV0*atlasSize) directly and the shrink
    // pushed EVERY face past the threshold, lifting all world slots +0.5).
    // Dropped/shelf items need that extra +0.5-block lift here because it can't
    // ride model.json (MC clamps ground display translation Y — verified
    // in-game) or the carrier elements (+8 is the model-format coordinate cap).
    // The range stays inside the same face-id texel, so decoding is unaffected.
    const MARKED_UV_SLOTS = { ground: true, on_shelf: true };
    function calibratedElementsForSlot(baseElements, slot) {
        const off = SLOT_OFFSETS[slot] || { x: 0, y: 0, z: 0 };
        const marked = !!MARKED_UV_SLOTS[slot];
        if (off.x === 0 && off.y === 0 && off.z === 0 && !marked) return baseElements;
        // Shift the U range +0.25/+0.05 texel: midpoint px+0.5 -> px+0.65.
        // (u1-u0) spans 0.8 texel, so one texel in uv units = (u1-u0)/0.8.
        const markUv = ([u0, v0, u1, v1]) => {
            const texel = (u1 - u0) / 0.8;
            return [u0 + 0.25 * texel, v0, u1 + 0.05 * texel, v1];
        };
        return baseElements.map(el => ({
            ...el,
            from: [el.from[0] + off.x, el.from[1] + off.y, el.from[2] + off.z],
            to:   [el.to[0]   + off.x, el.to[1]   + off.y, el.to[2]   + off.z],
            ...(marked ? {
                faces: Object.fromEntries(Object.entries(el.faces).map(
                    ([dir, f]) => [dir, { ...f, uv: markUv(f.uv) }])),
            } : {}),
        }));
    }

    // Build the display_context-keyed model node for one modelBaseName. This is
    // the per-model body that becomes a single custom_model_data case below.
    function buildDisplayContextModel(modelBaseName, exportedSlots) {
        const tints = [{ type: 'minecraft:potion', default: -1 }];
        const fallbackSlot = 'thirdperson_righthand';
        const ref = slot => `${EXPORT_NS}:item/${modelBaseName}_${slot}`;
        const cases = (exportedSlots || DISPLAY_SLOTS)
            .filter(s => s !== fallbackSlot)
            .map(slot => ({
                when: slot,
                model: { type: 'minecraft:model', model: ref(slot), tints },
            }));
        const fallbackModel = {
            type: 'minecraft:model',
            model: ref(fallbackSlot),
            tints,
        };
        if (cases.length === 0) return fallbackModel;
        return {
            type: 'minecraft:select',
            property: 'minecraft:display_context',
            cases,
            fallback: fallbackModel,
        };
    }

    // Item definition (assets/minecraft/items/<baseItem>.json). Mirrors the
    // shipped pack shape: an OUTER minecraft:select on custom_model_data keyed
    // by modelBaseName, with a vanilla fallback. A second model on the same
    // baseItem coexists by adding another custom_model_data case (see merge in
    // saveSingleOutput).
    function buildItemSelector(modelBaseName, exportedSlots, baseItem) {
        const base = baseItem || 'iron_ingot';
        return {
            // MANDATORY: default `true` makes Minecraft replay the item-swap
            // animation every time obj³ mutates the item's components per
            // animation frame, breaking the hand animation. Must be false.
            hand_animation_on_swap: false,
            model: {
                type: 'minecraft:select',
                property: 'minecraft:custom_model_data',
                index: 0,
                cases: [
                    { when: modelBaseName, model: buildDisplayContextModel(modelBaseName, exportedSlots) },
                ],
                fallback: { type: 'minecraft:model', model: `minecraft:item/${base}` },
            },
        };
    }

    // Identity transform — explicit override to prevent Minecraft's inferred
    // defaults for slots the user hasn't customised (notably GUI which would
    // otherwise inherit block/block rotation [30, 225, 0]).
    //
    // Single source of truth for display values:
    //   - Slots exposed in the Vue dialog (third/left/head/ground/fixed) get
    //     their values from buildDisplayTransforms which reads Vue defaults
    //     + native BB Display editor.
    //   - Slots NOT in the dialog (gui, firstperson, on_shelf) get IDENTITY
    //     here as a safety net so Minecraft's inferred block defaults
    //     (rotation [30,225,0], scale [0.625]) don't sneak in.
    //
    // KNOWN MINECRAFT QUIRK: for `ground` and `on_shelf` contexts the
    // engine clamps the Y component of display.translation (dropped items
    // are physically locked to the ground; shelf items to the surface).
    // X and Z still work. Y simply can't be calibrated for these slots.
    const IDENTITY_DISPLAY = { rotation: [0,0,0], translation: [0,0,0], scale: [1,1,1] };

    function pickDirectory(title, startpath) {
        return Blockbench.pickDirectory({ title, startpath: startpath || undefined });
    }

    // Build the per-slot model JSON string. Minified (no whitespace) since this
    // is the heavy full-geometry file. textures carries both 0 and particle so
    // Minecraft has break/landing particles instead of missing-texture.
    function buildSlotModelJson(pngName, slot, slotDisplay, elements) {
        const model = {
            textures: { 0: `${EXPORT_NS}:item/${pngName}`, particle: `${EXPORT_NS}:item/${pngName}` },
            elements: elements,
            display:  slotDisplay,
        };
        return JSON.stringify(model);
    }

    // Does an existing parsed item definition match the shape buildItemSelector
    // produces (outer custom_model_data select)? Only then is it safe to merge a
    // new case in; anything else gets backed up and overwritten.
    function isMergeableItemSelector(obj) {
        return !!(obj && obj.model &&
            obj.model.type === 'minecraft:select' &&
            obj.model.property === 'minecraft:custom_model_data' &&
            Array.isArray(obj.model.cases));
    }

    // Merge a new model into an existing item definition: replace the case for
    // modelBaseName if present, else append it. Returns the merged object.
    function mergeItemSelector(existing, modelBaseName, exportedSlots) {
        const node = buildDisplayContextModel(modelBaseName, exportedSlots);
        const cases = existing.model.cases.filter(c => c.when !== modelBaseName);
        cases.push({ when: modelBaseName, model: node });
        existing.model.cases = cases;
        // Heal an old file that predates this field (default true breaks the
        // hand animation); see buildItemSelector.
        existing.hand_animation_on_swap = false;
        return existing;
    }

    // assets/minecraft/atlases/blocks.json — ensures the objc_cubed item
    // textures are stitched into the block atlas (the atlas the objmc shaders
    // sample). A directory source with source 'item' picks up every
    // assets/<ns>/textures/item/*.png across all namespaces and registers it as
    // <ns>:item/<file>, which is exactly the ref buildSlotModelJson emits.
    function buildBlocksAtlas() {
        return { sources: [{ type: 'minecraft:directory', source: 'item', prefix: 'item/' }] };
    }

    // Add (idempotently) the item directory source to an existing parsed atlas.
    function mergeBlocksAtlas(existing) {
        const sources = Array.isArray(existing.sources) ? existing.sources : [];
        const has = sources.some(s => s &&
            (s.type === 'minecraft:directory' || s.type === 'directory') &&
            s.source === 'item' && (s.prefix === 'item/' || s.prefix === 'item'));
        if (!has) sources.push({ type: 'minecraft:directory', source: 'item', prefix: 'item/' });
        existing.sources = sources;
        return existing;
    }

    function saveSingleOutput(result, displayTransforms, cfg) {
        return new Promise((resolve, reject) => {
            const fs   = require('fs');
            const path = require('path');
            const name = (Project.name || 'model').replace(/[^a-z0-9_]/gi,'_').toLowerCase();

            // One-shot: pick the resource pack root once (only if not already
            // set). Everything else is written without further dialogs.
            const root = cfg.resourcePackDir || pickDirectory(t('lbl_respack_dir'), Project.export_path || '');
            if (!root) { reject(new Error('__cancelled__')); return; }

            const baseItem = (cfg.baseItem || 'iron_ingot').replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'iron_ingot';
            // custom_model_data name (issue #7). Used as BOTH the per-slot model
            // file base AND the custom_model_data case key, so the UI-facing name
            // and the in-game key the player puts on the item match. Falls back to
            // the sanitized project name when cfg.cmdName is unset.
            const modelName = ((cfg.cmdName || name).replace(/[^a-z0-9_]/gi, '_').toLowerCase()) || name;
            const texDir   = path.join(root, 'assets', EXPORT_NS, 'textures', 'item');
            const modelsDir= path.join(root, 'assets', EXPORT_NS, 'models', 'item');
            const itemsDir = path.join(root, 'assets', 'minecraft', 'items');
            const atlasDir = path.join(root, 'assets', 'minecraft', 'atlases');
            fs.mkdirSync(texDir,    { recursive: true });
            fs.mkdirSync(modelsDir, { recursive: true });
            fs.mkdirSync(itemsDir,  { recursive: true });
            fs.mkdirSync(atlasDir,  { recursive: true });

            // PNG → assets/objc_cubed/textures/item/<modelName>.png (no Blockbench.export).
            // Named after modelName so the per-slot model texture refs resolve.
            fs.writeFileSync(path.join(texDir, `${modelName}.png`), result.pngBuffer);

            // Determine which slots need their own model JSON. A slot differs
            // from the fallback (thirdperson_righthand) if it has a non-zero
            // SLOT_OFFSET or a non-identity displayTransforms entry.
            const FALLBACK_SLOT = 'thirdperson_righthand';
            const isIdentity = d => {
                if (!d) return true;
                const r = d.rotation || [0,0,0], tr = d.translation || [0,0,0], s = d.scale || [1,1,1];
                return r[0]===0 && r[1]===0 && r[2]===0 &&
                       tr[0]===0 && tr[1]===0 && tr[2]===0 &&
                       s[0]===1 && s[1]===1 && s[2]===1;
            };
            const exportedSlots = DISPLAY_SLOTS.filter(slot => {
                if (slot === FALLBACK_SLOT) return true;
                const off = SLOT_OFFSETS[slot] || { x:0, y:0, z:0 };
                if (off.x !== 0 || off.y !== 0 || off.z !== 0) return true;
                if (displayTransforms[slot] && !isIdentity(displayTransforms[slot])) return true;
                return false;
            });

            // Per-slot model JSONs → assets/objc_cubed/models/item/<modelName>_<slot>.json.
            //
            // VERTICAL-ORIGIN CONVENTION (in-game verified): the encoder bakes
            // Y-0.5 into the PNG positions, the carrier anchor c2 sits at the
            // block centre (from[8,8,8]), and the shader reconstructs display R*S
            // from the carrier edges — so with ALL lifts at 0 every slot matches
            // the same vanilla model exactly, rotations included. SLOT_LIFT_Y is
            // kept as a per-pose tuning knob (change only against in-game checks)
            // and so every slot gets an EXPLICIT display entry, which stops
            // Minecraft leaking block-model display defaults (scale ~0.4 / rot 45)
            // into un-set slots. The user's dialog display values add on top.
            // Written here — NOT in buildDisplayTransforms (it must stay a faithful
            // passthrough, see model-output.test) and NOT on cfg.displaySlots
            // (that would trip the hasStaticWorldDisplay bit).
            // gui has no model.json display at all: its transform is header-encoded
            // and applied by the GUI shader path.
            const SLOT_LIFT_Y = {
                head: 0, fixed: 0,
                thirdperson_righthand: 0, thirdperson_lefthand: 0,
                firstperson_righthand: 0, firstperson_lefthand: 0,
                // ground/on_shelf sit a FULL block below vanilla's dropped-item
                // pipeline (in-game measured). Carrier elements provide +0.5
                // (SLOT_OFFSETS +8 — capped by the model format, to.y <= 32);
                // the other +0.5 comes from the shader via the MARKED_UV_SLOTS
                // slot marker. Display translation is useless here: MC clamps
                // ground translation Y (re-verified in-game 2026-07).
                ground: 0, on_shelf: 0,
            };
            const liftSlot = (d, lift) => {
                const base = d || IDENTITY_DISPLAY;
                const t = base.translation || [0, 0, 0];
                return { ...base, translation: [t[0] || 0, (t[1] || 0) + lift, t[2] || 0] };
            };
            // (The -0.5 vertical-origin re-anchor is baked into the PNG for ALL
            // exports, armor included — the armor SHADER path re-adds it. No
            // element-shift compensation here: a shifted anchor rotates with the
            // display and only matched at identity.)
            for (const slot of exportedSlots) {
                const slotDisplay = { ...displayTransforms };
                for (const s in SLOT_LIFT_Y) slotDisplay[s] = liftSlot(slotDisplay[s], SLOT_LIFT_Y[s]);
                // fixed is lifted above; the unset-slot fallback below stops MC block-model
                // display defaults (scale ~0.4 / rot 45) leaking into the active slot.
                if (!slotDisplay[slot]) slotDisplay[slot] = IDENTITY_DISPLAY;
                if (!slotDisplay[slot]) slotDisplay[slot] = IDENTITY_DISPLAY;
                fs.writeFileSync(
                    path.join(modelsDir, `${modelName}_${slot}.json`),
                    buildSlotModelJson(modelName, slot, slotDisplay, calibratedElementsForSlot(result.elements, slot)),
                    'utf8'
                );
            }

            // Item override → assets/minecraft/items/<baseItem>.json. Merge a new
            // custom_model_data case into an existing matching file so a second
            // model on the same base item coexists; back up + overwrite if the
            // existing file is not our expected shape.
            const itemPath = path.join(itemsDir, `${baseItem}.json`);
            let itemObj;
            if (fs.existsSync(itemPath)) {
                let existing = null;
                try { existing = JSON.parse(fs.readFileSync(itemPath, 'utf8')); } catch (e) { existing = null; }
                if (existing && isMergeableItemSelector(existing)) {
                    itemObj = mergeItemSelector(existing, modelName, exportedSlots);
                    // Keep vanilla fallback pointed at the requested base item.
                    itemObj.model.fallback = { type: 'minecraft:model', model: `minecraft:item/${baseItem}` };
                } else {
                    try { fs.writeFileSync(itemPath + '.bak', fs.readFileSync(itemPath)); } catch (e) {}
                    itemObj = buildItemSelector(modelName, exportedSlots, baseItem);
                }
            } else {
                itemObj = buildItemSelector(modelName, exportedSlots, baseItem);
            }
            // Atomic write: this file aggregates EVERY model's custom_model_data case on
            // this base item, so a half-written/interrupted overwrite would destroy them
            // all. Stage to .tmp then rename (atomic on the same filesystem).
            { const tmp = itemPath + '.tmp';
              fs.writeFileSync(tmp, JSON.stringify(itemObj, null, 2), 'utf8');
              fs.renameSync(tmp, itemPath); }

            // give helper → assets/minecraft/items/<baseItem>_give.txt. The exact
            // command the player runs to get the base item carrying this model's
            // custom_model_data string. 1.21.4+ component shape: the
            // minecraft:custom_model_data component holds {strings:[...]} and the
            // item override's custom_model_data select reads index 0 of strings
            // (see buildItemSelector index:0), so strings[0] must equal modelName.
            fs.writeFileSync(
                path.join(itemsDir, `${baseItem}_give.txt`),
                `give @s minecraft:${baseItem}[minecraft:custom_model_data={strings:["${modelName}"]}]\n`,
                'utf8'
            );

            // Atlas stitch → assets/minecraft/atlases/blocks.json. Merge the
            // item directory source idempotently.
            const blocksAtlasPath = path.join(atlasDir, 'blocks.json');
            let atlasObj;
            if (fs.existsSync(blocksAtlasPath)) {
                let existing = null;
                try { existing = JSON.parse(fs.readFileSync(blocksAtlasPath, 'utf8')); } catch (e) { existing = null; }
                atlasObj = (existing && typeof existing === 'object') ? mergeBlocksAtlas(existing) : buildBlocksAtlas();
            } else {
                atlasObj = buildBlocksAtlas();
            }
            fs.writeFileSync(blocksAtlasPath, JSON.stringify(atlasObj, null, 2), 'utf8');

            // Datapack: only for multi-frame animations. Default to a datapacks/
            // folder next to the resource pack (no extra dialog when root is set).
            if (cfg.generateDatapack && result.nframes > 1) {
                // Legacy single-part armor exports write the equipment asset as
                // <model>_<slot> (per-piece exports use <model>_<piece>) — tell the
                // datapack the real name so its summon equips an asset that exists.
                const legacyEquipAsset = (cfg.exportAsEquipment
                    && !(Array.isArray(cfg.selectedPieces) && cfg.selectedPieces.length))
                    ? `${modelName}_${(cfg.equipmentSlot || 'chest').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`
                    : null;
                const dpFiles = generateDatapackFiles(
                    cfg.datapackAnimId, result.nframes,
                    cfg.datapackNamespace, cfg.datapackTargetType,
                    cfg.datapackEquipSlot,
                    baseItem, modelName, legacyEquipAsset
                );
                // Empty output dir defaults to a sibling of the resource pack. That default
                // is unwritable when the RP root is a Flatpak document-portal mount
                // (/run/user/.../doc/<id>/ — the portal grants the picked folder, not its
                // parent → mkdir EPERM). Don't let that abort the export (the RP already
                // wrote); warn with the path + the fix (pick a datapack folder explicitly).
                const dpBase = cfg.datapackOutputDir || path.join(root, '..', 'datapacks');
                const dpDir = path.join(dpBase, 'objcubed');
                try {
                    saveDatapackFiles(dpFiles, dpDir);
                } catch (e) {
                    surfaceWarning(`couldn't write the datapack to "${dpDir}" (${(e && e.message) || e}). The model + resource pack exported fine; to get the datapack, set the "Datapack output folder" to a writable location (e.g. your world's datapacks/ folder) and re-export.`);
                }
            } else if (cfg.generateDatapack && result.nframes <= 1) {
                // Datapack drives multi-frame playback; a single frame has nothing to
                // play. Silently skipping left the user expecting control functions.
                surfaceWarning('datapack was requested but the model has only 1 frame — no animation to drive, so no datapack was generated. Add an animation with 2+ frames.');
            }

            // Equipment (armor) export — Approach C. Written under the SAME
            // resource pack root as the item layout above, but into the vanilla
            // minecraft namespace (equipment defs + textures must live there).
            if (cfg.exportAsEquipment) {
                const equipNs = 'minecraft';
                const equipJsonDir = path.join(root, 'assets', equipNs, 'equipment');
                fs.mkdirSync(equipJsonDir, { recursive: true });
                const nLayers = result.nfaces;
                // Each armor PIECE -> layer type, slot, give item, the body parts it covers,
                // and its CARRIER box layout (abody -> part, from the shader's ABOX table) for
                // box-packing: one layer rides TWO model faces per carrier box (its NORTH and
                // SOUTH face), so a chestplate packs body+r_arm+l_arm x2 faces into one draw.
                // Parts: 0 body,1 head,2 r_arm,3 l_arm,4 r_leg,5 l_leg,6 r_foot,7 l_foot.
                const PIECE_MAP = {
                    helmet:     { layer: 'humanoid',          slot: 'head',  give: 'helmet',     allowed: [1],       carrier: [1],       nboxes: 2 },
                    chestplate: { layer: 'humanoid',          slot: 'chest', give: 'chestplate', allowed: [0, 2, 3], carrier: [2, 3, 0], nboxes: 3 },
                    leggings:   { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   allowed: [4, 5],    carrier: [5, 4, 0], nboxes: 3 },
                    boots:      { layer: 'humanoid',          slot: 'feet',  give: 'boots',      allowed: [6, 7],    carrier: [7, 6],    nboxes: 2 },
                };
                // Per-face emissive levels (light_emission, 0..15) so the armor shader can make
                // individual faces fullbright -- the vanilla light_emission model property only
                // affects item/block models, never equipment layers.
                const faceEmission = result.faceEmission
                    || (result.faceGroups || []).map(g => { const tk = parseFaceToken(g); return tk ? tk.emis : 0; });
                // Write one packed layer PNG: t[8].a = nboxes; per box abody, 4 carrier-face
                // model-face indices (16-bit) -> north t[8+abody].r:g (part in .b), south
                // t[11+abody], west header-texel 14+abody, east 17+abody; the 4 faces' emissive
                // levels pack into texel 20+abody (r=N,g=S,b=W,a=E). Missing face -> 65535
                // (culled). Header texels reach 20+nboxes-1 (=22 for 3 boxes) -> needs tw >= 23.
                const writePackedLayer = (texPath, nboxes, slots) => {
                    const buf = result.rawBuf.slice();
                    buf[3] = 253;                               // armor marker
                    buf[8 * 4 + 3] = nboxes & 255;              // t[8].a = box count
                    const put16 = (texel, k) => {
                        const o = texel * 4;
                        if (k == null) { buf[o] = 255; buf[o + 1] = 255; }
                        else { buf[o] = Math.trunc(k / 256) % 256; buf[o + 1] = k % 256; }
                    };
                    const emisOf = k => (k == null ? 0 : Math.max(0, Math.min(15, faceEmission[k] | 0)));
                    for (let abody = 0; abody < nboxes; abody++) {
                        const s = slots[abody] || {};
                        put16(8 + abody, s.northK);             // north -> t[8+abody].r:g
                        buf[(8 + abody) * 4 + 2] = (s.part || 0) & 255;   // part -> t[8+abody].b
                        put16(11 + abody, s.southK);            // south -> t[11+abody]
                        put16(14 + abody, s.westK);             // west  -> texel 14+abody
                        put16(17 + abody, s.eastK);             // east  -> texel 17+abody
                        const eo = (20 + abody) * 4;            // emissive -> texel 20+abody
                        buf[eo] = emisOf(s.northK); buf[eo + 1] = emisOf(s.southK);
                        buf[eo + 2] = emisOf(s.westK); buf[eo + 3] = emisOf(s.eastK);
                    }
                    fs.writeFileSync(texPath, encodePNG(result.tw, result.ty, buf));
                };
                // The packed armor header reaches row-0 column 22, so a <23px-wide
                // texture corrupts equipment (W/E faces + emissive). Surface it.
                if (result.tw < 23) throw new Error(`armor texture is only ${result.tw}px wide — equipment packing needs ≥23px (west/east faces + emissive pack to row-0 texel 22). Widen the texture and re-export.`);

                if (Array.isArray(cfg.selectedPieces) && cfg.selectedPieces.length) {
                    // PER-PIECE (whole-set) export, BOX-PACKED.
                    const faceToPart = result.faceToPart || buildFaceToPart(result.faceGroups, result.faceBlocks);
                    const _partCounts = {};
                    faceToPart.forEach(p => { _partCounts[p] = (_partCounts[p] || 0) + 1; });
                    console.log('[obj³] armor face→part counts (-1 = untagged):', JSON.stringify(_partCounts));
                    // Untagged faces (part -1) are silently dropped from every piece — tell the user.
                    if (_partCounts[-1] > 0) surfaceWarning(`${_partCounts[-1]} face(s) have no body-part tag and will NOT appear in any armor piece. Right-click each group → obj³: Body part to tag them.`);
                    for (const pieceKey of cfg.selectedPieces) {
                        const piece = PIECE_MAP[pieceKey];
                        if (!piece) continue;
                        const eqName = `${modelName}_${pieceKey}`;
                        const eqTexDir = path.join(root, 'assets', equipNs, 'textures', 'entity', 'equipment', piece.layer);
                        fs.mkdirSync(eqTexDir, { recursive: true });
                        // Faces per carrier box (by abody) = that box's part's faces, in order.
                        const boxFaces = piece.carrier.map(part =>
                            piece.allowed.indexOf(part) === -1 ? []
                                : faceToPart.reduce((a, p, k) => { if (p === part) a.push(k); return a; }, []));
                        // Four faces per box per layer: north@4L, south@4L+1, west@4L+2, east@4L+3.
                        const layerCount = Math.max(1, ...boxFaces.map(f => Math.ceil(f.length / 4)));
                        const layers = [];
                        for (let L = 0; L < layerCount; L++) {
                            const slots = piece.carrier.map((part, abody) => {
                                const fk = j => { const k = boxFaces[abody][4 * L + j]; return k == null ? null : k; };
                                const nk = fk(0), sk = fk(1), wk = fk(2), ek = fk(3);
                                if (nk == null && sk == null && wk == null && ek == null) return undefined;
                                return { northK: nk, southK: sk, westK: wk, eastK: ek, part };
                            });
                            if (slots.every(s => !s)) continue;           // empty layer
                            const texName = `${eqName}_${L}`;
                            writePackedLayer(path.join(eqTexDir, `${texName}.png`), piece.nboxes, slots);
                            layers.push({ texture: `${equipNs}:${texName}` });
                        }
                        // A piece with no tagged faces would write an empty {layers:{type:[]}}
                        // def (invisible armor) and still report success — skip + tell the user.
                        if (layers.length === 0) {
                            surfaceWarning(`armor piece "${pieceKey}" has no tagged faces for its body parts — nothing was written for it. Right-click the relevant groups → obj³: Body part to tag them.`);
                            continue;
                        }
                        fs.writeFileSync(path.join(equipJsonDir, `${eqName}.json`),
                            JSON.stringify({ layers: { [piece.layer]: layers } }, null, 2), 'utf8');
                        fs.writeFileSync(path.join(equipJsonDir, `${eqName}_give.txt`),
                            `give @s minecraft:leather_${piece.give}[minecraft:equippable={slot:"${piece.slot}",asset_id:"${equipNs}:${eqName}"}]\n`, 'utf8');
                    }
                } else {
                    // LEGACY single-part export: whole model anchored to ONE part. Uses the
                    // same box-packed format with only the target box active (others empty),
                    // two faces per layer (north + south) like the per-piece path.
                    const PART_MAP = {
                        chest:      { layer: 'humanoid',          slot: 'chest', give: 'chestplate', carrier: [2, 3, 0], nboxes: 3, id: 0 },
                        head:       { layer: 'humanoid',          slot: 'head',  give: 'helmet',     carrier: [1],       nboxes: 2, id: 1 },
                        right_arm:  { layer: 'humanoid',          slot: 'chest', give: 'chestplate', carrier: [2, 3, 0], nboxes: 3, id: 2 },
                        left_arm:   { layer: 'humanoid',          slot: 'chest', give: 'chestplate', carrier: [2, 3, 0], nboxes: 3, id: 3 },
                        right_leg:  { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   carrier: [5, 4, 0], nboxes: 3, id: 4 },
                        left_leg:   { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   carrier: [5, 4, 0], nboxes: 3, id: 5 },
                        right_foot: { layer: 'humanoid',          slot: 'feet',  give: 'boots',      carrier: [7, 6],    nboxes: 2, id: 6 },
                        left_foot:  { layer: 'humanoid',          slot: 'feet',  give: 'boots',      carrier: [7, 6],    nboxes: 2, id: 7 },
                        legs:       { layer: 'humanoid_leggings', slot: 'legs',  give: 'leggings',   carrier: [5, 4, 0], nboxes: 3, id: 5 },
                        feet:       { layer: 'humanoid',          slot: 'feet',  give: 'boots',      carrier: [7, 6],    nboxes: 2, id: 7 },
                    };
                    const partInfo = PART_MAP[cfg.equipmentSlot] || PART_MAP.chest;
                    const abodyOfTarget = Math.max(0, partInfo.carrier.indexOf(partInfo.id));
                    const layerType = partInfo.layer;
                    const slotKey = (cfg.equipmentSlot || 'chest').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
                    const eqName = `${modelName}_${slotKey}`;
                    const eqTexDir = path.join(root, 'assets', equipNs, 'textures', 'entity', 'equipment', layerType);
                    fs.mkdirSync(eqTexDir, { recursive: true });
                    const layers = [];
                    const fk = i => (i < nLayers) ? i : null;
                    for (let L = 0; L < Math.ceil(nLayers / 4); L++) {
                        const slots = [];
                        slots[abodyOfTarget] = {
                            northK: 4 * L,
                            southK: fk(4 * L + 1),
                            westK: fk(4 * L + 2),
                            eastK: fk(4 * L + 3),
                            part: partInfo.id,
                        };
                        const texName = `${eqName}_${L}`;
                        writePackedLayer(path.join(eqTexDir, `${texName}.png`), partInfo.nboxes, slots);
                        layers.push({ texture: `${equipNs}:${texName}` });
                    }
                    fs.writeFileSync(path.join(equipJsonDir, `${eqName}.json`),
                        JSON.stringify({ layers: { [layerType]: layers } }, null, 2), 'utf8');
                    fs.writeFileSync(path.join(equipJsonDir, `${eqName}_give.txt`),
                        `give @s minecraft:leather_${partInfo.give}[minecraft:equippable={slot:"${partInfo.slot}",asset_id:"${equipNs}:${eqName}"}]\n`, 'utf8');
                }
            }

            resolve();
        });
    }

    // =========================================================
    // Section 10b: Datapack Function Generation
    // =========================================================

    function generateDatapackFiles(animId, nframes, namespace, targetType, equipSlot, baseItem, modelName, equipAsset) {
        // equipAsset (optional): the exact equipment asset id suffix the resource
        // pack export actually wrote (legacy single-part exports name it by SLOT,
        // e.g. "cat_chest", while per-piece exports name it by PIECE, "cat_chestplate").
        // Without it the summon defaults to the per-piece convention.
        // Sanitize to valid resource-location chars [a-z0-9_.-]: free-text like
        // "My Pack" / "Walk!" would otherwise produce invalid namespaces and
        // `function ns:id` refs (baseItem/cmdName are already sanitized this way).
        const ns = ((namespace || 'objcubed').toLowerCase().replace(/[^a-z0-9_.-]/g, '_')) || 'objcubed';
        const id = ((animId || 'anim').toLowerCase().replace(/[^a-z0-9_.-]/g, '_')) || 'anim';
        const pub = `${id}`;
        const priv = `${id}/zzz`;
        const files = new Map();

        const EQUIP_PATH = {
            mainhand: 'equipment.mainhand', offhand: 'equipment.offhand',
            head: 'equipment.head', chest: 'equipment.chest',
            legs: 'equipment.legs', feet: 'equipment.feet',
        };
        const PLAYER_SLOT = {
            mainhand: 'weapon.mainhand', offhand: 'weapon.offhand',
            head: 'armor.head', chest: 'armor.chest',
            legs: 'armor.legs', feet: 'armor.feet',
        };

        const isPlayer = targetType === 'player';
        const equipPath = targetType === 'item_display'
            ? 'item'
            : (EQUIP_PATH[equipSlot] || 'equipment.mainhand');
        const playerSlot = PLAYER_SLOT[equipSlot] || 'weapon.mainhand';
        // Per-run isolation (A5): a per-animation tag + tight distance relative to
        // the executing player (@s) so concurrent player runs each grab only the
        // stand at their own feet (not another player's leftover stand).
        const tmpTag = `objcubed_temp_${id}`;
        const tmp = `@e[tag=${tmpTag},distance=..0.01,limit=1,sort=nearest]`;
        // Marker:1b -> no collision; spawn AT the player (execute at @s) so the
        // distance filter resolves to a stand at the player's position.
        const tmpSummon = `execute at @s run summon armor_stand ~ ~ ~ {Tags:["${tmpTag}"],Invisible:1b,Marker:1b}`;

        files.set('pack.mcmeta', JSON.stringify({
            pack: {
                description: 'obj³ animations',
                // Bare ints with min <= max. The old min_format:[101,1] (101.1) vs
                // max_format:101 (101.0) was an inverted/empty range MC flags as
                // incompatible. Permissive upper bound so it loads across versions.
                pack_format: 101,
                min_format: 101,
                max_format: 9999,
            },
        }, null, 2));

        // init — scoreboards + constants
        files.set(`data/${ns}/function/${pub}/init.mcfunction`, [
            `scoreboard objectives add ${id} dummy`,
            `scoreboard objectives add ${id}.end dummy`,
            `scoreboard players set #dur ${id} ${nframes}`,
            `scoreboard players set #base ${id} 8388608`,
            `scoreboard players set #cycle ${id} 24000`,
        ].join('\n'));

        // play — autoplay loop starting at frame 0 (synced to GameTime). Stores the
        // phase offset (gametime % dur) so frame 0 shows now and advances; re-issuing
        // restarts cleanly. (The old code did `-= @s` first, which on a second call read
        // the stored OFFSET as if it were the frame and jumped to a stale phase — use
        // play_from to start at a specific frame.)
        files.set(`data/${ns}/function/${pub}/play.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `execute store result score #gt ${id} run time query gametime`,
            `scoreboard players operation #gt ${id} %= #dur ${id}`,
            `scoreboard players operation @s ${id} = #gt ${id}`,
            `tag @s add ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_auto`,
        ].join('\n'));

        // stop — freeze at current frame
        files.set(`data/${ns}/function/${pub}/stop.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `# play_once: freeze at last frame`,
            `execute if entity @s[tag=${id}.once] run scoreboard players operation @s ${id} = #dur ${id}`,
            `execute if entity @s[tag=${id}.once] run scoreboard players remove @s ${id} 1`,
            `# autoplay: compute current frame`,
            `execute if entity @s[tag=${id}.auto] store result score #gt ${id} run time query gametime`,
            `execute if entity @s[tag=${id}.auto] run scoreboard players operation #gt ${id} -= @s ${id}`,
            `execute if entity @s[tag=${id}.auto] run scoreboard players operation #gt ${id} %= #dur ${id}`,
            `execute if entity @s[tag=${id}.auto] run scoreboard players operation @s ${id} = #gt ${id}`,
            `tag @s remove ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_manual`,
        ].join('\n'));

        // set — freeze at specific frame (user sets @s <id> = frame before calling)
        files.set(`data/${ns}/function/${pub}/set.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `tag @s remove ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_manual`,
        ].join('\n'));

        // play_from — autoplay loop from frame N (user sets @s <id> = N before calling)
        files.set(`data/${ns}/function/${pub}/play_from.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `execute store result score #gt ${id} run time query gametime`,
            `scoreboard players operation #gt ${id} -= @s ${id}`,
            `scoreboard players operation #gt ${id} %= #dur ${id}`,
            `scoreboard players operation @s ${id} = #gt ${id}`,
            `tag @s add ${id}.auto`,
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_auto`,
        ].join('\n'));

        // play_once — play one cycle then freeze at last frame.
        // Records an absolute deadline (monotonic gametime, NOT day-wrapped) so the
        // tick latch can freeze the entity permanently after nframes ticks.
        files.set(`data/${ns}/function/${pub}/play_once.mcfunction`, [
            `function ${ns}:${pub}/init`,
            `execute store result score @s ${id} run time query gametime`,
            `scoreboard players operation @s ${id} %= #cycle ${id}`,
            `scoreboard players add @s ${id} 32768`,
            // absolute deadline = now + nframes ticks (monotonic gametime, NOT day-wrapped)
            `execute store result score @s ${id}.end run time query gametime`,
            `scoreboard players add @s ${id}.end ${nframes}`,
            `tag @s remove ${id}.auto`,
            `tag @s add ${id}.once`,
            `function ${ns}:${priv}/_apply_auto`,
        ].join('\n'));

        // _apply_auto — set autoplay color (custom_color = tcolor from @s <id>)
        if (isPlayer) {
            // Every ${tmp} selector needs `at @s`: distance=..0.01 is measured from
            // the EXECUTION position, and the stand was summoned at @s — without it
            // a `execute as <player>` from a command block matches nothing (item
            // never updates + the temp stand leaks).
            files.set(`data/${ns}/function/${priv}/_apply_auto.mcfunction`, [
                tmpSummon,
                `execute at @s run item replace entity ${tmp} ${playerSlot} from entity @s ${playerSlot}`,
                `execute at @s run data modify entity ${tmp} ${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`,
                `execute at @s store result entity ${tmp} ${equipPath}.components."minecraft:potion_contents".custom_color int 1 run scoreboard players get @s ${id}`,
                `execute at @s run item replace entity @s ${playerSlot} from entity ${tmp} ${playerSlot}`,
                `execute at @s run kill ${tmp}`,
            ].join('\n'));
        } else {
            files.set(`data/${ns}/function/${priv}/_apply_auto.mcfunction`, [
                `data modify entity @s ${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`,
                `execute store result entity @s ${equipPath}.components."minecraft:potion_contents".custom_color int 1 run scoreboard players get @s ${id}`,
            ].join('\n'));
        }

        // _apply_manual — set manual color (custom_color = 0x800000 + frame from @s <id>)
        if (isPlayer) {
            files.set(`data/${ns}/function/${priv}/_apply_manual.mcfunction`, [
                `scoreboard players operation #temp ${id} = #base ${id}`,
                `scoreboard players operation #temp ${id} += @s ${id}`,
                tmpSummon,
                `execute at @s run item replace entity ${tmp} ${playerSlot} from entity @s ${playerSlot}`,
                `execute at @s run data modify entity ${tmp} ${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`,
                `execute at @s store result entity ${tmp} ${equipPath}.components."minecraft:potion_contents".custom_color int 1 run scoreboard players get #temp ${id}`,
                `execute at @s run item replace entity @s ${playerSlot} from entity ${tmp} ${playerSlot}`,
                `execute at @s run kill ${tmp}`,
            ].join('\n'));
        } else {
            files.set(`data/${ns}/function/${priv}/_apply_manual.mcfunction`, [
                `scoreboard players operation #temp ${id} = #base ${id}`,
                `scoreboard players operation #temp ${id} += @s ${id}`,
                `data modify entity @s ${equipPath}.components."minecraft:potion_contents" set value {custom_color:0}`,
                `execute store result entity @s ${equipPath}.components."minecraft:potion_contents".custom_color int 1 run scoreboard players get #temp ${id}`,
            ].join('\n'));
        }

        // tick latch: per-entity, freezes play_once at the last frame once its
        // absolute deadline passes (survives the GameTime day-wrap). Latch-only —
        // playback stays shader-driven (render-fps), this just flips once.
        files.set(`data/${ns}/function/${pub}/tick.mcfunction`, [
            `execute as @e[tag=${id}.once] run function ${ns}:${priv}/_check_once`,
        ].join('\n'));
        files.set(`data/${ns}/function/${priv}/_check_once.mcfunction`, [
            `execute store result score #now ${id} run time query gametime`,
            `execute if score #now ${id} >= @s ${id}.end run function ${ns}:${priv}/_latch_once`,
        ].join('\n'));
        files.set(`data/${ns}/function/${priv}/_latch_once.mcfunction`, [
            `scoreboard players set @s ${id} ${nframes - 1}`,   // static last frame
            `tag @s remove ${id}.once`,
            `function ${ns}:${priv}/_apply_manual`,
        ].join('\n'));
        files.set('data/minecraft/tags/function/tick.json', JSON.stringify({
            values: [`${ns}:${pub}/tick`],
        }, null, 2));

        const base = (baseItem || 'stick').toLowerCase().replace(/[^a-z0-9_.]/g, '_') || 'stick';
        const model = (modelName || id);
        const entityTag = `${ns}.${pub}`;

        // load tag → init scoreboards once at datapack load (no manual init call)
        files.set('data/minecraft/tags/function/load.json', JSON.stringify({
            values: [`${ns}:${pub}/init`],
        }, null, 2));

        // summon.mcfunction — create + tag the entity this datapack animates.
        if (targetType === 'item_display') {
            files.set(`data/${ns}/function/${pub}/summon.mcfunction`, [
                `summon item_display ~ ~ ~ {Tags:["${entityTag}"],billboard:"fixed",item:{id:"minecraft:${base}",count:1,components:{"minecraft:custom_model_data":{strings:["${model}"]}}}}`,
            ].join('\n'));
        } else if (!isPlayer) {
            // equipment target: an armor_stand summoned ALREADY wearing/holding the
            // obj³ item, so the per-slot equipment NBT exists for _apply_auto to
            // data-modify (an empty slot cannot be animated). The slot key is the
            // exact equipment NBT key (head/chest/legs/feet/mainhand/offhand).
            const ARMOR_PIECE = { head: 'helmet', chest: 'chestplate', legs: 'leggings', feet: 'boots' };
            const slot = ARMOR_PIECE[equipSlot] ? equipSlot : (EQUIP_PATH[equipSlot] ? equipSlot : 'mainhand');
            let equipItem;
            if (ARMOR_PIECE[slot]) {
                // ARMOR slot: leather piece carrying the equippable component that
                // points at the armor export asset (eqName = <model>_<piece>).
                const piece = ARMOR_PIECE[slot];
                equipItem = `${slot}:{id:"minecraft:leather_${piece}",count:1,components:{"minecraft:equippable":{slot:"${slot}",asset_id:"minecraft:${equipAsset || `${model}_${piece}`}"}}}`;
            } else {
                // HAND slot: the base item with custom_model_data (mirror item_display).
                equipItem = `${slot}:{id:"minecraft:${base}",count:1,components:{"minecraft:custom_model_data":{strings:["${model}"]}}}`;
            }
            files.set(`data/${ns}/function/${pub}/summon.mcfunction`, [
                `summon armor_stand ~ ~ ~ {Tags:["${entityTag}"],ShowArms:1b,NoGravity:1b,equipment:{${equipItem}}}`,
            ].join('\n'));
        }
        // player target: cannot be summoned — README documents the held-item path.

        files.set('README.txt', [
            `obj³ datapack — animation "${id}" (namespace "${ns}")`,
            ``,
            `INSTALL: drop this "objcubed" folder into <world>/datapacks/ and run /reload.`,
            `  (init scoreboards run automatically via the minecraft:load tag.)`,
            ``,
            targetType === 'item_display'
                ? `SPAWN:   function ${ns}:${pub}/summon   (creates a tagged item_display)`
                : (isPlayer
                    ? `SPAWN:   none — give yourself the item from ${base}_give.txt and run the controls as yourself.`
                    : `SPAWN:   function ${ns}:${pub}/summon   (spawns an armor_stand ALREADY equipped with the obj³ item). To wear it yourself instead, give from ${model}_<piece>_give.txt.`),
            ``,
            `CONTROL (run AS the entity, e.g. execute as @e[tag=${ns}.${pub}] run …):`,
            `  ${ns}:${pub}/play        loop from frame 0`,
            `  ${ns}:${pub}/play_once   play once then freeze`,
            `  ${ns}:${pub}/play_from   loop from frame N (set score @s ${id} = N first)`,
            `  ${ns}:${pub}/set         freeze at frame N (set score @s ${id} = N first)`,
            `  ${ns}:${pub}/stop        freeze at the current frame`,
            ``,
        ].join('\n'));

        return files;
    }

    function saveDatapackFiles(files, basePath) {
        const fs   = require('fs');
        const path = require('path');
        for (const [relPath, content] of files) {
            const fullPath = path.join(basePath, relPath);
            if (relPath === 'pack.mcmeta' && fs.existsSync(fullPath)) continue;
            const dir = path.dirname(fullPath);
            fs.mkdirSync(dir, { recursive: true });
            if (/tags\/function\/(tick|load)\.json$/.test(relPath) && fs.existsSync(fullPath)) {
                // merge our function into the existing tag (don't clobber other packs')
                let existing = {};
                try { existing = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch (e) {}
                const have = new Set(Array.isArray(existing.values) ? existing.values : []);
                for (const v of JSON.parse(content).values) have.add(v);
                fs.writeFileSync(fullPath, JSON.stringify({ values: [...have] }, null, 2), 'utf8');
                continue;
            }
            fs.writeFileSync(fullPath, content, 'utf8');
        }
    }

    // =========================================================
    // Section 11: Dialog
    // =========================================================
    function showDialog() {
        if (!Project) {
            Blockbench.showMessageBox({ title:'obj³', message: t('no_project') }); return;
        }
        if (!Texture.all.length) {
            Blockbench.showMessageBox({ title:'obj³', message: t('no_textures') }); return;
        }

        const hasAnims    = Animation.all.length > 0;
        // Closure state — kept outside Vue.data because Vue 2 doesn't proxy
        // _-prefixed names, which would silently break access from methods.
        let dialogDefaults = {};
        let suspendPersist = false;

        // Guided tour (issue #4) — non-reactive, closure-level alias of the
        // top-level TOUR_STEPS (single source of truth). sel is resolved
        // against this.$el at run time (sel:null = centered card; '__export__'
        // = the native dialog-bar Export button via .dialog). Exposed to the
        // template via the tourSteps() computed below. Keep the oc-tour-*
        // marker classes in the template in sync with these selectors.
        const tourSteps = TOUR_STEPS;

        const dialog = new Dialog({
            id:    PLUGIN_ID + '_dialog',
            title: t('dialog_title'),
            width: Math.min((typeof window !== 'undefined' ? window.innerWidth - 80 : Math.round(820 * UI_SCALE)), Math.round(820 * UI_SCALE)),
            component: {
                data() {
                    const firstAnim = Animation.all[0];
                    const hasArm = hasNonGeometryElements();
                    const state = {
                        // ---- Ephemeral (not persisted) ----
                        texOptions:    Texture.all.map((t,i)=>({label:t.name||`Texture ${i}`,value:i,thumb:t.source})),
                        multiTex:      Texture.all.length > 1,
                        animOptions:   Animation.all.map((a,i)=>({label:a.name||`Anim ${i}`,value:i})),
                        hasAnims,
                        hasArmature:   hasArm,
                        status: '',
                        statusKind: 'progress', // 'progress' | 'done' | 'error' | 'cancelled' — drives footer color
                        running: false,
                        // Guided tour (issue #4) — ephemeral, NOT persisted.
                        // tourActive gates the overlay; tourIndex points into the
                        // closure-level tourSteps. The "seen once" flag lives in
                        // localStorage('objcubed_tour_seen'), not in state.
                        tourActive: false,
                        tourIndex:  0,

                        // ---- Persisted (PERSISTABLE_FIELDS) ----
                        // Texture
                        selectedTex:   0,
                        useAtlas:      Texture.all.length > 1,
                        atlasTexChecked: Texture.all.map(() => true),
                        // Animated textures (issue #9): bake a vertical frame strip
                        texAnimEnabled: false,
                        texFrametime:  1,
                        texFade:       false,
                        // Transform
                        scale:         1,
                        offsetX:       0, offsetY: 0, offsetZ: 0,
                        // Animation
                        animationEnabled: false,
                        animationIndex:0,
                        animFps:       firstAnim ? (firstAnim.snapping||20) : 20,
                        animStart:     0,
                        animEnd:       firstAnim ? firstAnim.length : 0,
                        autoplay:      true,
                        // Datapack
                        generateDatapack: false,
                        datapackNamespace: 'objcubed',
                        datapackAnimId:  (firstAnim ? (firstAnim.name || 'anim') : 'anim')
                            .replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 12) || 'anim',
                        datapackTargetType: 'equipment',
                        datapackEquipSlot: 'mainhand',
                        datapackOutputDir: '',
                        // Output paths
                        resourcePackDir: '',
                        baseItem: 'iron_ingot',
                        // custom_model_data name — the string put on the base item
                        // to show the model. Defaults to the sanitized project name
                        // (same sanitization saveSingleOutput uses). This is the
                        // case key in the item override + the per-slot model base.
                        cmdName: (Project.name || 'model').replace(/[^a-z0-9_]/gi,'_').toLowerCase(),
                        // Equipment (armor) export — Approach C
                        exportAsEquipment: false,
                        equipmentSlot: 'chest',
                        selectedPieces: [],
                        // Display — Right hand (also used for left UNLESS useSeparateLefthand)
                        displayTab:    'third',   // 'third' | 'head' | 'ground' | 'fixed'
                        useSeparateLefthand: false,
                        // Thirdperson rotation default 0° — no baked-in tilt.
                        // Earlier builds shipped a 5° X default (and legacy objmc
                        // projects an 85° one); both baked an unwanted rotation
                        // into the exported thirdperson display. Default is now
                        // identity; the user dials in any tilt explicitly.
                        dThirdRX: 0, dThirdRY: 0, dThirdRZ: 0,
                        dThirdTX: 0, dThirdTY: 0, dThirdTZ: 0,
                        dThirdSX: 1, dThirdSY: 1, dThirdSZ: 1,
                        // Display — Left hand (third-person, only used when useSeparateLefthand=true)
                        dLeftRX: 0, dLeftRY: 0, dLeftRZ: 0,
                        dLeftTX: 0, dLeftTY: 0, dLeftTZ: 0,
                        dLeftSX: 1, dLeftSY: 1, dLeftSZ: 1,
                        // Display — Head/Ground/Fixed
                        dHeadRX: 0, dHeadRY: 0, dHeadRZ: 0,
                        dHeadTX: 0, dHeadTY: 0, dHeadTZ: 0,
                        dHeadSX: 1, dHeadSY: 1, dHeadSZ: 1,
                        dGroundRX: 0, dGroundRY: 0, dGroundRZ: 0,
                        dGroundTX: 0, dGroundTY: 0, dGroundTZ: 0,
                        dGroundSX: 1, dGroundSY: 1, dGroundSZ: 1,
                        dFixedRX: 0, dFixedRY: 0, dFixedRZ: 0,
                        dFixedTX: 0, dFixedTY: 0, dFixedTZ: 0,
                        dFixedSX: 1, dFixedSY: 1, dFixedSZ: 1,
                        // Display — GUI (inventory)
                        dGuiRX: 0, dGuiRY: 0, dGuiRZ: 0,
                        dGuiTX: 0, dGuiTY: 0, dGuiTZ: 0,
                        dGuiSX: 1, dGuiSY: 1, dGuiSZ: 1,
                        // GUI rotation pivot, in BB units (16 = 1 block; 0 = origin
                        // = block centre in the decoded frame). 0/0/0 = auto: rotate
                        // about the block centre — vanilla's display pivot (any
                        // non-zero value overrides it). Encoder divides by 16 to the
                        // decoded block frame; the shader rotates the GUI display about it.
                        dGuiPX: 0, dGuiPY: 0, dGuiPZ: 0,
                        // Display — First-person right hand
                        dFprRX: 0, dFprRY: 0, dFprRZ: 0,
                        dFprTX: 0, dFprTY: 0, dFprTZ: 0,
                        dFprSX: 1, dFprSY: 1, dFprSZ: 1,
                        // Display — First-person left hand
                        dFplRX: 0, dFplRY: 0, dFplRZ: 0,
                        dFplTX: 0, dFplTY: 0, dFplTZ: 0,
                        dFplSX: 1, dFplSY: 1, dFplSZ: 1,
                        // Display — On shelf
                        dShelfRX: 0, dShelfRY: 0, dShelfRZ: 0,
                        dShelfTX: 0, dShelfTY: 0, dShelfTZ: 0,
                        dShelfSX: 1, dShelfSY: 1, dShelfSZ: 1,
                        // Color & Tinting
                        cbR: 'direct', cbG: 'direct', cbB: 'direct',
                        // Advanced
                        easing:        1,
                        interpolation: 1,
                        autorotate:    1,
                        flipuv:        false,
                        noshadow:      false,
                        // Default to PoT padding ON: the encoder/shader layout is
                        // already PoT-independent (header encodes the DATA height,
                        // shader normalizes by the real atlasSize, so padding is
                        // cosmetic blank rows that never shift sampled texels), but
                        // an NPOT *PNG* still gets refused by old GPUs/drivers and
                        // shows up as the intermittent "broken model" symptom. PoT
                        // by default renders everywhere; users who know their GPU
                        // handles NPOT can tick the box to reclaim the space.
                        nopow:         false,
                        filterArmature: hasArm,
                    };

                    // Snapshot of the freshly-built defaults — stashed on the
                    // closure (NOT on Vue state) because Vue 2 doesn't proxy
                    // property names starting with _ or $, which would silently
                    // leave them undefined when accessed as this._defaults.
                    dialogDefaults = {};
                    for (const k of PERSISTABLE_FIELDS) dialogDefaults[k] = state[k];

                    // Overlay any persisted values from the active preset.
                    const persisted = loadActiveSettings();
                    if (persisted) {
                        for (const k of PERSISTABLE_FIELDS) {
                            if (Object.prototype.hasOwnProperty.call(persisted, k)) {
                                state[k] = persisted[k];
                            }
                        }
                        // Legacy migration: old projects persisted thirdperson
                        // rotation X as 85° (objmc convention) or 5° (an earlier
                        // build's default). Both baked an unwanted tilt. New
                        // default is 0° (no rotation). Normalize 85 and 5 → 0
                        // silently so old projects don't keep the stale tilt.
                        if (state.dThirdRX === 85 || state.dThirdRX === 5) state.dThirdRX = 0;
                        if (state.dLeftRX  === 85 || state.dLeftRX  === 5) state.dLeftRX  = 0;

                        // Persistence-boundary coercion: a corrupt/hand-edited
                        // .bbmodel may persist array fields as non-arrays; restore
                        // the freshly-built default so no downstream .map/.some/
                        // index read can throw (closes the atlasTexChecked class).
                        for (const k of ['atlasTexChecked', 'selectedPieces']) {
                            if (!Array.isArray(state[k])) state[k] = dialogDefaults[k];
                        }
                    }

                    // Sync animEnd with the current animation length only when the
                    // persisted trim is unset/invalid or exceeds the clip — a saved
                    // end-trim must survive a dialog reopen (animStart already does).
                    const curAnim = Animation.all[state.animationIndex];
                    if (curAnim && (!(state.animEnd > state.animStart) || state.animEnd > curAnim.length))
                        state.animEnd = curAnim.length;

                    suspendPersist = false;
                    return state;
                },
                created() {
                    // Auto-save every persisted field to Project.objcubed_data
                    // on change. This means closing the project after just
                    // opening the dialog is enough to preserve current settings.
                    const persist = () => {
                        if (suspendPersist) return;
                        const snap = {};
                        for (const k of PERSISTABLE_FIELDS) snap[k] = this[k];
                        saveActiveSettings(snap);
                    };
                    for (const k of PERSISTABLE_FIELDS) {
                        this.$watch(k, persist, { deep: true });
                    }
                },
                mounted() {
                    // If the user just came back from BB's Display editor, pull their
                    // edits (Project.display_settings) into the dialog so they reach the
                    // export. One-shot flag set by openInDisplayEditor; cleared here.
                    // Session-scoped + project-checked (was localStorage: a machine-
                    // global flag survived restarts and fired in OTHER projects,
                    // clobbering their display fields with the wrong project's data).
                    try {
                        if (pullDisplayForProject && typeof Project !== 'undefined' && Project
                            && Project.uuid === pullDisplayForProject) {
                            this._loadFromDisplaySettings();
                        }
                        pullDisplayForProject = null;
                    } catch (e) {}
                    // Tooltip portal — single floating element repositioned per hover.
                    // Lives on document.body so it never gets clipped by the dialog.
                    let tip = document.getElementById('oc-tooltip-portal');
                    if (!tip) {
                        tip = document.createElement('div');
                        tip.id = 'oc-tooltip-portal';
                        tip.className = 'oc-tooltip';
                        document.body.appendChild(tip);
                    }
                    // Tooltip lives outside .oc-root, so it can't inherit the
                    // scale var — set it explicitly to the fixed UI scale.
                    tip.style.setProperty('--oc-scale', UI_SCALE);
                    this._tipEl = tip;
                    const show = (target) => {
                        const text = target.getAttribute('data-tip');
                        if (!text) return;
                        tip.textContent = text;
                        // Reset positioning so measurement is clean
                        tip.style.left = '0px';
                        tip.style.top  = '0px';
                        tip.classList.add('visible');
                        // Measure
                        const r = target.getBoundingClientRect();
                        const t = tip.getBoundingClientRect();
                        const pad = 6, edge = 8;
                        let left = r.left + r.width/2 - t.width/2;
                        let top  = r.top  - t.height - pad;
                        // Keep inside viewport
                        if (left < edge) left = edge;
                        if (left + t.width > window.innerWidth - edge)
                            left = window.innerWidth - edge - t.width;
                        if (top < edge) top = r.bottom + pad;  // flip below
                        tip.style.left = left + 'px';
                        tip.style.top  = top  + 'px';
                    };
                    const hide = () => tip.classList.remove('visible');
                    this.$el.addEventListener('mouseover', (e) => {
                        const t = e.target.closest('[data-tip]');
                        if (t && this.$el.contains(t)) show(t);
                    });
                    this.$el.addEventListener('mouseout', (e) => {
                        const t = e.target.closest('[data-tip]');
                        if (t) hide();
                    });
                    // Style the Export button in the dialog bar
                    this.$nextTick(() => {
                        const dlg = this.$el.closest('.dialog');
                        if (dlg) {
                            const btns = dlg.querySelectorAll('.dialog_bar button');
                            if (btns[0]) {
                                btns[0].style.cssText = 'background:rgba(90,140,192,0.25);color:#cde;font-weight:600;border:none;border-radius:4px;padding:6px 24px;';
                            }
                        }
                        // Issue #10: the in-dialog 3D preview was removed (BB's
                        // renderer renders blank inside a modal). Opening the dialog
                        // no longer switches the app into Display mode; the new
                        // "Open in Blockbench Display editor" button does that
                        // explicitly on demand (see openInDisplayEditor).

                        // Issue #4: auto-show the guided tour the first time this
                        // dialog ever opens on this machine. The "seen" flag is a
                        // single localStorage key; the header ? button replays it.
                        let seen = true;
                        try { seen = !!localStorage.getItem('objcubed_tour_seen'); } catch (e) {}
                        if (!seen) this.$nextTick(() => this.startTour());
                    });
                },
                beforeDestroy() {
                    const tip = document.getElementById('oc-tooltip-portal');
                    if (tip) tip.remove();
                    // Issue #10: no in-dialog preview anymore — nothing GL/RAF to
                    // dispose. Opening the dialog no longer touches editor state.
                    // Issue #4: the tour overlay is rendered inside this.$el via
                    // v-if, so Vue tears it down with the component. Nothing extra
                    // to remove, but guard against any stray nodes if a future
                    // refactor portals them out.
                    // Closing mid-tour (Close/Esc) bypasses tourEnd, which is the only
                    // place that restored fields a tour step force-revealed (animationEnabled,
                    // generateDatapack, exportAsEquipment…). Without this they'd persist
                    // forced-ON to the project. Mirror tourEnd's restore + persist explicitly
                    // (the field watcher may not flush during teardown).
                    if (this._tourSaved) {
                        for (const k in this._tourSaved) this[k] = this._tourSaved[k];
                        this._tourSaved = null;
                        const snap = {};
                        for (const k of PERSISTABLE_FIELDS) snap[k] = this[k];
                        saveActiveSettings(snap);
                    }
                    this.tourActive = false;
                },
                computed: {
                    // Issue #4: expose the closure-level (non-reactive) tour step
                    // list to the template. tourActive/tourIndex (reactive) drive
                    // which step renders; the array itself never changes.
                    tourSteps() { return hasAnims ? tourSteps : tourSteps.filter(s => !s.requiresAnims); },
                    showDatapackOption() {
                        return this.hasAnims && this.animationEnabled;
                    },
                    selectedTexThumb() {
                        const tex = Texture.all[this.selectedTex];
                        return tex ? tex.source : '';
                    },
                    // Issue #10: is BlockBench's real Display mode usable for the
                    // Enabled whenever a project is open. BB normally gates its
                    // Display mode behind Format.display_mode, but openInDisplayEditor
                    // force-enables that flag for the session, so the button stays
                    // usable even for formats (Generic/free) that leave it off.
                    displayModeAvailable() {
                        return typeof Project !== 'undefined' && !!Project;
                    },
                    // Animated textures (issue #9): how many square frames the
                    // selected texture's vertical strip holds (height / width).
                    // Frames the anim UI reveals on. Single texture: the selected
                    // texture's strip count. Atlas: the LARGEST strip among the
                    // checked atlas textures (one animated strip per atlas), so the
                    // control appears in atlas mode too (where selectedTex is hidden).
                    texFrameCount() {
                        const framesOf = (tex) => {
                            if (!tex) return 1;
                            const w = (tex.img && tex.img.naturalWidth)  || tex.width  || 16;
                            const h = (tex.img && tex.img.naturalHeight) || tex.height || 16;
                            return w < 1 ? 1 : Math.floor(h / w);
                        };
                        if (this.useAtlas) {
                            const counts = atlasTexIndicesFrom(this.atlasTexChecked)
                                .map(i => framesOf(Texture.all[i]));
                            return counts.length ? Math.max(1, ...counts) : 1;
                        }
                        return framesOf(Texture.all[this.selectedTex]);
                    },
                    frameCountPreview() {
                        if (!this.hasAnims || !this.animationEnabled) return '';
                        const fps = +this.animFps || 1;
                        const start = +this.animStart || 0;
                        const end = +this.animEnd || 0;
                        if (end <= start) return '';
                        const n = Math.max(1, Math.floor((end - start) * fps + 1e-6) + 1);
                        return n + ' ' + tPlural(n, 'frames');
                    },
                    // Auto-computed duration in ticks (1 tick = 1/20 s).
                    // Shown instead of the manual input now.
                    durationTicksAuto() {
                        const start = +this.animStart || 0;
                        const end   = +this.animEnd || 0;
                        if (end <= start) return 0;
                        return Math.max(1, Math.round((end - start) * 20));
                    },
                    // ---- Preview banner ----
                    previewFaceCount() {
                        return estimateFaceCount(!!this.filterArmature);
                    },
                    previewFrameCount() {
                        if (!this.hasAnims || !this.animationEnabled) return 1;
                        const fps = +this.animFps || 1;
                        const start = +this.animStart || 0;
                        const end = +this.animEnd || 0;
                        if (end <= start) return 1;
                        return Math.max(1, Math.floor((end - start) * fps + 1e-6) + 1);
                    },
                    previewTexSize() {
                        // Returns {w, h} based on current texture/atlas choice.
                        if (this.useAtlas) {
                            // Array-guarded via atlasTexIndicesFrom so a corrupt/hand-edited
                            // project whose persisted atlasTexChecked is a non-array doesn't
                            // make this computed throw `TypeError: …map is not a function`
                            // (final-review fix; same class as C1/C3).
                            const selected = atlasTexIndicesFrom(this.atlasTexChecked)
                                .map(i => Texture.all[i])
                                .filter(Boolean);
                            if (!selected.length) return null;
                            let w = 0, h = 0;
                            for (const t of selected) {
                                const tw = (t.img && t.img.naturalWidth) || t.width || 16;
                                const th = (t.img && t.img.naturalHeight) || t.height || 16;
                                if (tw > w) w = tw;
                                h += th;
                            }
                            return { w, h };
                        }
                        const tex = Texture.all[this.selectedTex];
                        if (!tex) return null;
                        return {
                            w: (tex.img && tex.img.naturalWidth) || tex.width || 16,
                            h: (tex.img && tex.img.naturalHeight) || tex.height || 16,
                        };
                    },
                    previewPngSize() {
                        const ts = this.previewTexSize;
                        if (!ts) return null;
                        return estimateOutputPng(this.previewFaceCount, this.previewFrameCount,
                                                  ts.w, ts.h, !!this.nopow);
                    },
                    previewPngSizePretty() {
                        const e = this.previewPngSize;
                        if (!e) return '';
                        const kb = e.approxBytes / 1024;
                        if (kb < 1) return `~${e.approxBytes} ${t('unit_b')}`;
                        if (kb < 1024) return `~${kb.toFixed(1)} ${t('unit_kb')}`;
                        return `~${(kb/1024).toFixed(2)} ${t('unit_mb')}`;
                    },
                    previewWarnings() {
                        const w = [];
                        if (this.previewFaceCount === 0) {
                            w.push({ level:'error', msg: t('warn_model_empty') });
                            return w;
                        }
                        if (this.previewFaceCount > 20000) {
                            w.push({ level:'warn',
                                msg: t('warn_too_many_faces').replace('{n}', this.previewFaceCount) });
                        }
                        const ts = this.previewTexSize;
                        if (ts && ts.w > 512) {
                            w.push({ level:'warn',
                                msg: t('warn_tex_wide').replace('{w}', ts.w) });
                        }
                        if (ts && ts.w < 8) {
                            w.push({ level:'error',
                                msg: t('warn_tex_narrow').replace('{w}', ts.w) });
                        }
                        if (this.filterArmature && !this.hasArmature) {
                            w.push({ level:'warn',
                                msg: t('warn_filter_no_armature') });
                        }
                        if (this.useAtlas && this.multiTex && !(Array.isArray(this.atlasTexChecked) && this.atlasTexChecked.some(v=>v))) {
                            w.push({ level:'error', msg: t('warn_atlas_empty') });
                        }
                        // Animated textures: strip must be a whole stack of square frames.
                        if (this.texAnimEnabled && ts && ts.w > 0 && (ts.h % ts.w) !== 0) {
                            w.push({ level:'error',
                                msg: t('warn_tex_strip_ratio').replace('{w}', ts.w).replace('{h}', ts.h) });
                        }
                        return w;
                    },
                    // Color & Tinting: pretty description of what each channel does.
                    colorBehaviorPretty() {
                        const effective = this.generateDatapack && this.showDatapackOption
                            ? ['time','time','time'] : [this.cbR, this.cbG, this.cbB];
                        if (effective.every(v => v === 'direct'))
                            return t('color_all_direct');
                        if (effective.every(v => v === 'time'))
                            return t('color_all_time');
                        if (effective.every(v => v === 'scale'))
                            return t('color_all_scale');
                        if (effective.every(v => v === 'overlay'))
                            return t('color_all_overlay');
                        if (effective.every(v => v === 'hurt'))
                            return t('color_all_hurt');
                        // Mixed combo — no summary (the per-button labels already tell the user).
                        return '';
                    },
                    // Which preset (if any) the current R/G/B combo matches.
                    colorBehaviorPreset() {
                        const k = `${this.cbR}/${this.cbG}/${this.cbB}`;
                        return ({
                            'direct/direct/direct': 'tint',
                            'time/time/time':       'anim',
                            'scale/scale/scale':    'scale',
                            'overlay/overlay/overlay': 'overlay',
                            'hurt/hurt/hurt':       'hurt',
                        })[k] || null;
                    },
                    // True if the datapack-mode side-effects override user color settings.
                    colorBehaviorForcedByDatapack() {
                        return this.generateDatapack && this.showDatapackOption;
                    },
                    validationErrors() {
                        const errs = [];
                        if (this.useAtlas && this.multiTex && !(Array.isArray(this.atlasTexChecked) && this.atlasTexChecked.some(v => v)))
                            errs.push({ field:'atlas', msg: t('err_atlas_none') });
                        // (removed: orphaned scale<=0 validation — `scale` has no UI input,
                        // so this was an unrecoverable dead-end for legacy/corrupt persisted
                        // values; the encoder coerces a non-positive scale to 1 instead.)
                        if (this.hasAnims && this.animationEnabled) {
                            if (+this.animEnd <= +this.animStart)
                                errs.push({ field:'animEnd', msg: t('err_end_before_start') });
                            if (+this.animFps < 1)
                                errs.push({ field:'animFps', msg: t('err_fps_min') });
                            else if (+this.animFps > 60)
                                errs.push({ field:'animFps', msg: t('err_fps_max') });
                        }
                        if (this.generateDatapack && this.showDatapackOption) {
                            if (!this.datapackAnimId.trim())
                                errs.push({ field:'datapackAnimId', msg: t('err_need_anim_id') });
                            if (!this.datapackNamespace.trim())
                                errs.push({ field:'datapackNamespace', msg: t('err_need_namespace') });
                        }
                        return errs;
                    },
                    fieldErrorMap() {
                        const m = {};
                        for (const e of this.validationErrors) m[e.field] = e.msg;
                        return m;
                    },
                    errorBadgeTitle() {
                        return this.validationErrors.map(e => '• ' + e.msg).join('\n');
                    },
                },
                watch: {
                    // No implicit side-effects on generateDatapack toggle —
                    // the dialog now shows an explicit notice and the export
                    // path applies time/time/time + autoplay=false in doExport.
                    animationEnabled(val) {
                        if (!val) return;
                        const anim = Animation.all[this.animationIndex];
                        if (!anim) return;
                        if (+this.animEnd <= +this.animStart) {
                            this.animFps   = anim.snapping || this.animFps || 20;
                            this.animStart = 0;
                            this.animEnd   = anim.length || this.animEnd;
                            this.datapackAnimId = (anim.name || 'anim')
                                .replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 12) || 'anim';
                        }
                    },
                },
                methods: {
                    t(key) { return t(key); },
                    tPlural(n, key) { return tPlural(n, key); },
                    help(k) { return t('help_' + k) || ''; },
                    hasErr(field) { return !!this.fieldErrorMap[field]; },
                    // ── Guided tour (issue #4) ────────────────────────────
                    // Coach-mark tour over the real dialog elements. One spotlight
                    // engine (positionTour) dims the dialog and cuts a hole over
                    // the current step's target; a card narrates. Replayable via
                    // the header ? button; auto-shown once (mounted gate).
                    startTour() {
                        this.tourIndex = 0;
                        this.tourActive = true;
                        this.applyTourReveal();
                        this.$nextTick(() => this.positionTour());
                    },
                    tourNext() {
                        if (this.tourIndex >= this.tourSteps.length - 1) { this.tourEnd(true); return; }
                        this.tourIndex++;
                        this.applyTourReveal();
                        this.$nextTick(() => this.positionTour());
                    },
                    tourPrev() {
                        if (this.tourIndex <= 0) return;
                        this.tourIndex--;
                        this.applyTourReveal();
                        this.$nextTick(() => this.positionTour());
                    },
                    // Some steps anchor to controls inside a toggled-off section
                    // (autoplay/datapack need animationEnabled). Turn the section on
                    // before measuring so its anchor exists; restored in tourEnd.
                    applyTourReveal() {
                        const step = this.tourSteps[this.tourIndex];
                        if (!step || !step.reveal) return;
                        if (!this._tourSaved) this._tourSaved = {};
                        for (const k in step.reveal) {
                            if (!(k in this._tourSaved)) this._tourSaved[k] = this[k];
                            this[k] = step.reveal[k];
                        }
                    },
                    // Snap texFrametime back to a valid >=1 integer (min= only guards the
                    // spinner; a typed 0/-5 otherwise lingers in the field while export clamps).
                    clampTexFrametime() { this.texFrametime = Math.max(1, Math.round(+this.texFrametime || 1)); },
                    // Vue 2 can't track assignment to an array index (atlasTexChecked[i] = v),
                    // so the index-bound v-model left dependent computeds (previewTexSize,
                    // previewWarnings, validationErrors) stale; $set restores reactivity.
                    setAtlasChecked(i, val) { this.$set(this.atlasTexChecked, i, val); },
                    tourEnd(persistSeen) {
                        this.tourActive = false;
                        // Restore anything a step revealed (e.g. animationEnabled).
                        if (this._tourSaved) {
                            for (const k in this._tourSaved) this[k] = this._tourSaved[k];
                            this._tourSaved = null;
                        }
                        if (persistSeen) {
                            try { localStorage.setItem('objcubed_tour_seen', '1'); } catch (e) {}
                        }
                    },
                    // Resolve the current step's target and place the spotlight
                    // hole + card. sel:null centers the card with no hole. Missing
                    // targets are skipped (card centered). Forces the third-person
                    // tab visible before measuring its v-show-gated row.
                    positionTour() {
                        if (!this.tourActive) return;
                        const step = this.tourSteps[this.tourIndex];
                        const hole = this.$el && this.$el.ownerDocument
                            ? this.$el.ownerDocument.getElementById('oc-tour-hole') : null;
                        const card = this.$el && this.$el.ownerDocument
                            ? this.$el.ownerDocument.getElementById('oc-tour-card') : null;
                        if (!card) return;
                        const vw = window.innerWidth, vh = window.innerHeight;
                        // position:fixed is viewport-relative UNLESS an ancestor establishes a
                        // containing block (transform/filter/perspective/will-change/contain) —
                        // some custom BlockBench themes do this on the dialog, which makes the
                        // tour spotlight + card drift sideways. Find that ancestor and convert
                        // our viewport coords into it (cbOff = {0,0} for the default theme).
                        const cbOff = (() => {
                            let p = card.parentElement;
                            while (p && p.nodeType === 1) {
                                const s = getComputedStyle(p);
                                if ((s.transform && s.transform !== 'none') ||
                                    (s.filter && s.filter !== 'none') ||
                                    (s.perspective && s.perspective !== 'none') ||
                                    /transform|filter|perspective/.test(s.willChange || '') ||
                                    /paint|layout|strict|content/.test(s.contain || '')) {
                                    const r = p.getBoundingClientRect();
                                    return { x: r.left, y: r.top };
                                }
                                p = p.parentElement;
                            }
                            return { x: 0, y: 0 };
                        })();
                        // No spotlight: center the card.
                        const center = () => {
                            // Full dim, no spotlight cutout: a 0x0 hole at the screen
                            // centre whose 9999px box-shadow darkens everything; hide
                            // the ring so no dot shows. (Fixes the un-dimmed welcome.)
                            if (hole) {
                                hole.style.display = 'block';
                                hole.style.outline = 'none';
                                hole.style.left   = Math.round(vw / 2 - cbOff.x) + 'px';
                                hole.style.top    = Math.round(vh / 2 - cbOff.y) + 'px';
                                hole.style.width  = '0px';
                                hole.style.height = '0px';
                            }
                            const cr = card.getBoundingClientRect();
                            card.style.left = Math.round((vw - cr.width) / 2 - cbOff.x) + 'px';
                            card.style.top  = Math.round((vh - cr.height) / 2 - cbOff.y) + 'px';
                        };
                        if (!step || !step.sel) { center(); return; }
                        let target = null;
                        if (step.sel === '__export__') {
                            const dlg = this.$el && this.$el.closest('.dialog');
                            target = dlg ? dlg.querySelector('.dialog_bar button') : null;
                        } else {
                            target = this.$el ? this.$el.querySelector(step.sel) : null;
                        }
                        if (!target) { center(); return; }
                        // Smooth-scroll the target into view so the window glides
                        // instead of teleporting when the next step is below the fold.
                        try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
                        // Re-measure each frame; place() reads the live rect.
                        const place = () => {
                            const r = target.getBoundingClientRect();
                            const pad = 6;
                            if (hole) {
                                hole.style.display = 'block';
                                hole.style.outline = '';  // restore the CSS spotlight ring
                                hole.style.left   = (r.left - pad - cbOff.x) + 'px';
                                hole.style.top    = (r.top - pad - cbOff.y) + 'px';
                                hole.style.width  = (r.width + pad * 2) + 'px';
                                hole.style.height = (r.height + pad * 2) + 'px';
                            }
                            // Place the card beside the spotlight: pick the side
                            // (below/above the target) with more room so it never
                            // flips into a cramped corner, then clamp fully inside
                            // the viewport on BOTH axes so it can't fly off-screen.
                            const cr = card.getBoundingClientRect();
                            const edge = 10, gap = 12;
                            const roomBelow = vh - r.bottom - gap;
                            const roomAbove = r.top - gap;
                            let top = (roomBelow >= cr.height || roomBelow >= roomAbove)
                                ? r.bottom + gap
                                : r.top - gap - cr.height;
                            let left = r.left + r.width / 2 - cr.width / 2;
                            top  = Math.max(edge, Math.min(top,  vh - cr.height - edge));
                            left = Math.max(edge, Math.min(left, vw - cr.width  - edge));
                            card.style.left = Math.round(left - cbOff.x) + 'px';
                            card.style.top  = Math.round(top - cbOff.y) + 'px';
                        };
                        // Smooth scroll is async AND eases in slowly, so a naive
                        // "stabilized" check trips on the slow first frames and pins
                        // the hole to the pre-scroll position (spotlight lands on the
                        // wrong element). FOLLOW the scroll, re-placing every frame,
                        // and only treat it as settled AFTER it has actually moved
                        // (or, when no scroll was needed, after a short grace period).
                        if (typeof requestAnimationFrame === 'function') {
                            let prevTop = NaN, settled = 0, frames = 0, moved = false;
                            const follow = () => {
                                if (!this.tourActive) return;
                                place();
                                const top = target.getBoundingClientRect().top;
                                if (!Number.isNaN(prevTop)) {
                                    if (Math.abs(top - prevTop) >= 0.5) { moved = true; settled = 0; }
                                    else settled++;
                                }
                                prevTop = top;
                                const done = (moved && settled >= 3)    // scrolled, now stable
                                          || (!moved && settled >= 12)   // never scrolled (already in view)
                                          || ++frames >= 90;             // hard cap ~1.5s
                                if (done) { place(); return; }
                                requestAnimationFrame(follow);
                            };
                            requestAnimationFrame(follow);
                        } else {
                            place();
                        }
                    },
                    startDrag(event, field, step) {
                        const input = event.currentTarget.querySelector('input');
                        const startX = event.clientX;
                        const startVal = parseFloat(this[field]) || 0;
                        const s = step || 1;
                        let dragged = false;
                        const onMove = (e) => {
                            const dx = e.clientX - startX;
                            if (!dragged && Math.abs(dx) < 3) return;
                            dragged = true;
                            e.preventDefault();
                            input.blur();
                            this[field] = Math.round((startVal + dx * s) * 100) / 100;
                            document.body.style.cursor = 'ew-resize';
                            document.body.style.userSelect = 'none';
                        };
                        const onUp = () => {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                            document.body.style.cursor = '';
                            document.body.style.userSelect = '';
                            if (!dragged) { input.focus(); input.select(); }
                        };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                    },
                    closeDialog() { if (dialog) dialog.close(); },
                    // Map a dialog tab id to BlockBench's display-slot key.
                    _slotKeyFor(tab) {
                        return ({
                            third:  'thirdperson_righthand',
                            fpr:    'firstperson_righthand',
                            fpl:    'firstperson_lefthand',
                            head:   'head',
                            gui:    'gui',
                            ground: 'ground',
                            fixed:  'fixed',
                            shelf:  'on_shelf',
                        })[tab] || 'thirdperson_righthand';
                    },
                    // Per-slot transforms from the dialog's d* fields, keyed by BB
                    // display-slot key, in BB / vanilla units (deg, 1/16 block, mult).
                    // Same d*->{rotation,translation,scale} mapping the export path
                    // (doExport.cfg.displaySlots) uses, so BB's editor shows exactly
                    // what the dialog has set. lefthand always mirrors thirdperson.
                    _dialogSlotTransforms() {
                        const v = (k) => +this[k] || 0;
                        // Scale: blank/garbage -> 1, but a TYPED 0 stays 0 (the
                        // standard vanilla trick to hide an item in a display slot;
                        // `|| 1` would silently un-hide it).
                        const sv = (k) => {
                            const raw = this[k];
                            if (raw === '' || raw == null) return 1;
                            const n = +raw;
                            return Number.isFinite(n) ? n : 1;
                        };
                        const third = {
                            rotation:    [v('dThirdRX'), v('dThirdRY'), v('dThirdRZ')],
                            translation: [v('dThirdTX'), v('dThirdTY'), v('dThirdTZ')],
                            scale:       [sv('dThirdSX'), sv('dThirdSY'), sv('dThirdSZ')],
                        };
                        return {
                            thirdperson_righthand: third,
                            thirdperson_lefthand: this.useSeparateLefthand ? {
                                rotation:    [v('dLeftRX'), v('dLeftRY'), v('dLeftRZ')],
                                translation: [v('dLeftTX'), v('dLeftTY'), v('dLeftTZ')],
                                scale:       [sv('dLeftSX'), sv('dLeftSY'), sv('dLeftSZ')],
                            } : third,
                            firstperson_righthand: {
                                rotation:    [v('dFprRX'), v('dFprRY'), v('dFprRZ')],
                                translation: [v('dFprTX'), v('dFprTY'), v('dFprTZ')],
                                scale:       [sv('dFprSX'), sv('dFprSY'), sv('dFprSZ')],
                            },
                            firstperson_lefthand: {
                                rotation:    [v('dFplRX'), v('dFplRY'), v('dFplRZ')],
                                translation: [v('dFplTX'), v('dFplTY'), v('dFplTZ')],
                                scale:       [sv('dFplSX'), sv('dFplSY'), sv('dFplSZ')],
                            },
                            head: {
                                rotation:    [v('dHeadRX'), v('dHeadRY'), v('dHeadRZ')],
                                translation: [v('dHeadTX'), v('dHeadTY'), v('dHeadTZ')],
                                scale:       [sv('dHeadSX'), sv('dHeadSY'), sv('dHeadSZ')],
                            },
                            gui: {
                                rotation:    [v('dGuiRX'), v('dGuiRY'), v('dGuiRZ')],
                                translation: [v('dGuiTX'), v('dGuiTY'), v('dGuiTZ')],
                                scale:       [sv('dGuiSX'), sv('dGuiSY'), sv('dGuiSZ')],
                                // (No pivot here: this feeds BB's Display editor, which
                                // has no pivot field. The GUI pivot is export-only.)
                            },
                            ground: {
                                rotation:    [v('dGroundRX'), v('dGroundRY'), v('dGroundRZ')],
                                translation: [v('dGroundTX'), v('dGroundTY'), v('dGroundTZ')],
                                scale:       [sv('dGroundSX'), sv('dGroundSY'), sv('dGroundSZ')],
                            },
                            fixed: {
                                rotation:    [v('dFixedRX'), v('dFixedRY'), v('dFixedRZ')],
                                translation: [v('dFixedTX'), v('dFixedTY'), v('dFixedTZ')],
                                scale:       [sv('dFixedSX'), sv('dFixedSY'), sv('dFixedSZ')],
                            },
                            on_shelf: {
                                rotation:    [v('dShelfRX'), v('dShelfRY'), v('dShelfRZ')],
                                translation: [v('dShelfTX'), v('dShelfTY'), v('dShelfTZ')],
                                scale:       [sv('dShelfSX'), sv('dShelfSY'), sv('dShelfSZ')],
                            },
                        };
                    },
                    // Issue #10 two-way sync: pull BB's live display values (including
                    // edits made in BB's real Display editor) back into the dialog d*
                    // fields, so they show in the dialog AND reach the export. Called on
                    // open only after the user used the editor (one-shot flag), so it
                    // never pulls BB's inferred defaults on a normal open.
                    _loadFromDisplaySettings() {
                        if (typeof Project === 'undefined' || !Project || !Project.display_settings) return;
                        const PFX = {
                            thirdperson_righthand: 'dThird', thirdperson_lefthand: 'dLeft',
                            firstperson_righthand: 'dFpr',   firstperson_lefthand: 'dFpl',
                            head: 'dHead', gui: 'dGui', ground: 'dGround', fixed: 'dFixed', on_shelf: 'dShelf',
                        };
                        const ds = Project.display_settings;
                        for (const key in PFX) {
                            const slot = ds[key];
                            if (!slot) continue;
                            const p = PFX[key], r = slot.rotation, tr = slot.translation, s = slot.scale;
                            if (r && r.length === 3) { this[p+'RX'] = +r[0]||0; this[p+'RY'] = +r[1]||0; this[p+'RZ'] = +r[2]||0; }
                            if (tr && tr.length === 3) { this[p+'TX'] = +tr[0]||0; this[p+'TY'] = +tr[1]||0; this[p+'TZ'] = +tr[2]||0; }
                            // A 0 scale set in BB's editor is deliberate (hidden item) — keep it.
                            if (s && s.length === 3) {
                                const sn = (x) => Number.isFinite(+x) ? +x : 1;
                                this[p+'SX'] = sn(s[0]); this[p+'SY'] = sn(s[1]); this[p+'SZ'] = sn(s[2]);
                            }
                        }
                    },
                    // Issue #10: replaces the old in-dialog 3D preview. Writes the
                    // dialog's current per-slot transforms into the object BB's
                    // Display editor reads (Project.display_settings[slot], the
                    // DisplaySlot instances BB renders + lets you drag), enters BB's
                    // real Display mode on the active tab's slot, then closes this
                    // dialog so the editor is visible. Every BB touchpoint is guarded
                    // so a version/API mismatch degrades to a quick message, never a
                    // crash. NOTE: this is a one-way hand-off — edits the user makes
                    // inside BB's editor are not read back into the dialog; the dialog
                    // stays the source of truth for export.
                    openInDisplayEditor() {
                        if (typeof Project === 'undefined' || !Project) {
                            if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                                Blockbench.showQuickMessage(t('open_display_disabled'), 3000);
                            }
                            return;
                        }
                        const slotKey = this._slotKeyFor(this.displayTab);
                        // BB gates its Display mode behind Format.display_mode, which
                        // many obj3 source formats (Generic / free) leave off. Enable
                        // it for this session so the real editor can open; BB builds
                        // the display scene from the model geometry regardless.
                        try {
                            if (typeof Format !== 'undefined' && Format && !Format.display_mode) {
                                Format.display_mode = true;
                            }
                        } catch (e) {}
                        try {
                            // 1) Push dialog transforms into the display object BB reads.
                            if (typeof Project !== 'undefined' && Project) {
                                const settings = Project.display_settings || (Project.display_settings = {});
                                const transforms = this._dialogSlotTransforms();
                                for (const key in transforms) {
                                    const tr = transforms[key];
                                    let slot = settings[key];
                                    // Reuse the existing DisplaySlot if present (keeps BB's
                                    // class instance), else fall back to a plain object;
                                    // BB reads .rotation/.translation/.scale either way.
                                    if (!slot) {
                                        slot = (typeof DisplaySlot !== 'undefined')
                                            ? new DisplaySlot() : {};
                                        settings[key] = slot;
                                    }
                                    slot.rotation    = tr.rotation.slice();
                                    slot.translation = tr.translation.slice();
                                    slot.scale       = tr.scale.slice();
                                }
                            }
                        } catch (e) { /* mapping failed — still try to open the editor */ }

                        let entered = false;
                        try {
                            // 2) Switch BB into its real Display mode, on the active slot.
                            if (typeof Modes !== 'undefined' && Modes.options && Modes.options.display
                                && typeof Modes.options.display.select === 'function') {
                                Modes.options.display.select();
                                entered = (typeof Mode === 'undefined' || !Mode.selected
                                    || Mode.selected.id === 'display');
                                if (entered && typeof DisplayMode !== 'undefined'
                                    && typeof DisplayMode.load === 'function') {
                                    try { DisplayMode.load(slotKey); } catch (e) {}
                                    // Re-apply our just-written base values (load() may
                                    // re-read the slot; updateDisplayBase pushes them).
                                    if (typeof DisplayMode.updateDisplayBase === 'function') {
                                        try { DisplayMode.updateDisplayBase(); } catch (e) {}
                                    }
                                }
                            }
                        } catch (e) { entered = false; }

                        if (!entered) {
                            if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                                Blockbench.showQuickMessage(t('open_display_disabled'), 3000);
                            }
                            return; // leave the dialog open so the user is not stranded
                        }

                        if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                            try { Blockbench.showQuickMessage(t('status_display_mode'), 3500); } catch (e) {}
                        }
                        // Flag a one-shot pull so the NEXT time this dialog opens it
                        // reads back whatever the user adjusts in BB's Display editor,
                        // so those edits reach the export (two-way sync).
                        try { pullDisplayForProject = (typeof Project !== 'undefined' && Project && Project.uuid) || null; } catch (e) {}
                        // 3) Close this dialog so the now-behind BB editor is visible.
                        this.closeDialog();
                    },
                    scrollToFirstError() {
                        // Triggered by clicking the error badge in the footer.
                        // Scrolls the first .oc-err element into view and focuses it.
                        this.$nextTick(() => {
                            const el = this.$el && this.$el.querySelector('.oc-err');
                            if (!el) return;
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            const focusable = el.matches('input,select,textarea') ? el
                                : el.querySelector('input,select,textarea');
                            if (focusable) focusable.focus({ preventScroll: true });
                        });
                    },

                    browseDatapackDir() {
                        const dir = Blockbench.pickDirectory({
                            title: t('lbl_datapack_dir'),
                            startpath: this.datapackOutputDir || undefined,
                        });
                        if (dir) this.datapackOutputDir = dir;
                    },
                    browseResourcePackDir() {
                        const dir = Blockbench.pickDirectory({
                            title: t('lbl_respack_dir'),
                            startpath: this.resourcePackDir || undefined,
                        });
                        if (dir) this.resourcePackDir = dir;
                    },
                    cycleCb(channel) {
                        // Click a channel button → step through direct→time→overlay→hurt.
                        // 'scale' is intentionally not offered in the UI cycle (kept in the
                        // shader's index mapping for backward compatibility, see cbArr).
                        if (this.colorBehaviorForcedByDatapack) return;
                        const ORDER = ['direct','time','overlay','hurt'];
                        const cur = this[channel];
                        const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
                        this[channel] = next;
                    },
                    applyColorPreset(name) {
                        if (this.colorBehaviorForcedByDatapack) return;
                        const PRESETS = {
                            tint:    ['direct','direct','direct'],
                            anim:    ['time','time','time'],
                            scale:   ['scale','scale','scale'],
                            overlay: ['overlay','overlay','overlay'],
                            hurt:    ['hurt','hurt','hurt'],
                        };
                        const v = PRESETS[name];
                        if (!v) return;
                        this.cbR = v[0]; this.cbG = v[1]; this.cbB = v[2];
                    },
                    cbLabel(value) {
                        return ({
                            direct: t('cb_direct'), time: t('cb_time'),
                            scale: t('cb_scale'), overlay: t('cb_overlay'), hurt: t('cb_hurt'),
                        })[value] || value;
                    },
                    onAnimChange() {
                        const anim = Animation.all[this.animationIndex];
                        if (anim) {
                            this.animFps = anim.snapping || 20;
                            this.animEnd = anim.length;
                            this.datapackAnimId = (anim.name || 'anim')
                                .replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 12) || 'anim';
                        }
                    },
                    async doExport() {
                        const wantDatapack = !!this.generateDatapack && this.showDatapackOption;
                        const cbParts = wantDatapack
                            ? ['time', 'time', 'time']
                            : [this.cbR, this.cbG, this.cbB];
                        this.running = true;
                        this.statusKind = 'progress';
                        this.status  = t('status_building');
                        try {
                            const cfg = {
                                texIndex:        +this.selectedTex,
                                useAtlas:        !!this.useAtlas,
                                atlasTexIndices:  atlasTexIndicesFrom(this.atlasTexChecked),
                                texAnimEnabled:  !!this.texAnimEnabled,
                                texFrametime:    Math.max(1, Math.round(+this.texFrametime || 1)),
                                texFade:         !!this.texFade,
                                scale:           +this.scale,
                                offset:          [+this.offsetX, +this.offsetY, +this.offsetZ],
                                animationEnabled: this.hasAnims && this.animationEnabled,
                                animationIndex:  +this.animationIndex,
                                animFps:         +this.animFps,
                                animStart:       +this.animStart,
                                animEnd:         +this.animEnd,
                                duration:        wantDatapack ? 0 : this.durationTicksAuto,
                                easing:          +this.easing,
                                interpolation:   +this.interpolation,
                                colorbehavior:   cbParts,
                                autorotate:      +this.autorotate,
                                autoplay:        wantDatapack ? false : !!this.autoplay,
                                flipuv:          !!this.flipuv,
                                noshadow:        !!this.noshadow,
                                nopow:           !!this.nopow,
                                filterArmature:  !!this.filterArmature,
                                visibility:      7, // world(4) + hand(2) + gui(1) — always all
                                generateDatapack: wantDatapack,
                                datapackNamespace: this.datapackNamespace || 'objcubed',
                                datapackAnimId:  this.datapackAnimId || 'anim',
                                datapackTargetType: this.datapackTargetType,
                                datapackEquipSlot:  this.datapackEquipSlot,
                                datapackOutputDir:  this.datapackOutputDir,
                                resourcePackDir:    this.resourcePackDir,
                                baseItem:           this.baseItem,
                                cmdName:            this.cmdName,
                                exportAsEquipment:  !!this.exportAsEquipment,
                                equipmentSlot:      this.equipmentSlot,
                                selectedPieces:     Array.isArray(this.selectedPieces) ? this.selectedPieces.slice() : [],
                                displaySlots: (() => {
                                    // Single source of truth: reuse the BB-editor transforms
                                    // (scale already `|| 1`, rot/trans `|| 0`) and add the
                                    // export-only GUI rotation pivot (BB units 0..16 → /16).
                                    const slots = this._dialogSlotTransforms();
                                    slots.gui.pivot = [
                                        (+this.dGuiPX || 0) / 16,
                                        (+this.dGuiPY || 0) / 16,
                                        (+this.dGuiPZ || 0) / 16,
                                    ];
                                    return slots;
                                })(),
                            };
                            await runExport(cfg, msg => { this.status = msg; });
                            this.statusKind = 'done';
                        } catch(err) {
                            if (err && err.message === '__cancelled__') {
                                this.statusKind = 'cancelled';
                                this.status = t('status_cancelled');
                                if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                                    Blockbench.showQuickMessage(t('status_cancelled'), 2500);
                                }
                            } else {
                                // Null-safe: a non-Error/falsy throw (e.g. `throw null`) would
                                // make `err.message` a secondary TypeError that masks the real
                                // failure. Coerce to a string for both the status and the toast.
                                const m = (err && err.message) || String(err);
                                this.statusKind = 'error';
                                this.status = t('export_failed') + m;
                                console.error('[obj3]', err);
                                if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
                                    Blockbench.showQuickMessage(t('export_failed') + m, 4000);
                                }
                            }
                        } finally {
                            this.running = false;
                        }
                    },
                },
                template: `
<div class="oc-root" style="padding:16px 20px;line-height:1.6;overflow-x:hidden;">

  <!-- Header row: replay the guided tour (issue #4) -->
  <div class="oc-root-head">
    <button type="button" class="oc-tour-btn" @click="startTour" :title="t('tour_btn')">
      <i class="material-icons">help_outline</i><span>{{t('tour_btn')}}</span>
    </button>
  </div>

  <!-- ======== TEXTURE ======== -->
  <!-- oc-tour-texture: tour anchor (issue #4) — keep on the Texture card -->
  <div class="oc-section oc-tour-texture" style="padding:10px 12px;">
    <div class="oc-section-head">
      <i class="material-icons">image</i>
      <span>{{t('section_texture')}}</span>
      <span class="oc-help" :data-tip="help('selectedTex')">?</span>
    </div>
    <!-- Single texture: preview + select -->
    <div v-if="!multiTex" style="display:flex;align-items:center;gap:10px;padding:0 4px;">
      <img v-if="selectedTexThumb" :src="selectedTexThumb"
           style="width:48px;height:48px;image-rendering:pixelated;border-radius:4px;object-fit:contain;background:rgba(255,255,255,0.04);flex-shrink:0;"/>
      <select v-model="selectedTex" style="flex:1;padding:4px 6px;">
        <option v-for="tx in texOptions" :key="tx.value" :value="tx.value">{{tx.label}}</option>
      </select>
    </div>
    <!-- Multi-texture: atlas toggle + list -->
    <div v-else style="padding:0 4px;">
      <!-- oc-tour-atlas: tour anchor (issue #4) — on the combine-into-atlas toggle -->
      <label class="oc-tour-atlas" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;">
        <input type="checkbox" v-model="useAtlas"/>
        <span>{{t('atlas_combine')}}</span>
        <span class="oc-help" :data-tip="help('useAtlas')">?</span>
      </label>
      <div v-if="!useAtlas" style="display:flex;align-items:center;gap:10px;">
        <img v-if="selectedTexThumb" :src="selectedTexThumb"
             style="width:48px;height:48px;image-rendering:pixelated;border-radius:4px;object-fit:contain;background:rgba(255,255,255,0.04);flex-shrink:0;"/>
        <select v-model="selectedTex" style="flex:1;padding:4px 6px;">
          <option v-for="tx in texOptions" :key="tx.value" :value="tx.value">{{tx.label}}</option>
        </select>
      </div>
      <div v-else :class="hasErr('atlas') ? 'oc-err' : ''" style="padding:6px 8px;border-radius:4px;background:rgba(255,255,255,0.02);display:flex;flex-direction:column;gap:5px;">
        <label v-for="(tx, i) in texOptions" :key="tx.value" style="display:flex;align-items:center;gap:8px;line-height:1.4;cursor:pointer;">
          <input type="checkbox" :checked="atlasTexChecked[i]" @change="setAtlasChecked(i, $event.target.checked)"/>
          <img v-if="tx.thumb" :src="tx.thumb" class="oc-tex-thumb"/>
          <span>{{tx.label}}</span>
        </label>
      </div>
    </div>
    <!-- Animated textures (issue #9): only when the strip holds >1 square frame.
         Styled to mirror the Animation section (behaviour card) below. -->
    <div v-if="texFrameCount > 1" class="oc-tour-texanim" style="border-top:1px solid rgba(255,255,255,0.06);margin-top:8px;padding-top:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="font-weight:600;color:#ddd;display:inline-flex;align-items:center;gap:6px;flex:1;">
          <input type="checkbox" v-model="texAnimEnabled"/>
          <span>{{t('tex_anim_enable').replace('{n}', texFrameCount)}}</span>
          <span class="oc-help" :data-tip="help('texAnim')">?</span>
        </label>
      </div>
      <div v-if="texAnimEnabled" style="margin-top:10px;display:flex;flex-direction:column;gap:10px;">
        <label style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;max-width:140px;">
          <span>{{t('tex_frametime')}}<span class="oc-help" :data-tip="help('texFrametime')">?</span></span>
          <input v-model.number="texFrametime" type="number" min="1" step="1" @change="clampTexFrametime"/>
        </label>
        <div class="oc-frame-chip">
          <i class="material-icons">movie</i>
          <span>{{texFrameCount}} {{tPlural(texFrameCount,'frames')}} · {{texFrametime}} {{tPlural(texFrametime,'ticks')}} {{t('tex_chip_each')}}</span>
        </div>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:calc(12px * var(--oc-scale));">
          <input type="checkbox" v-model="texFade"/>
          <span>{{t('tex_fade')}}</span>
          <span class="oc-help" :data-tip="help('texFade')">?</span>
        </label>
      </div>
    </div>
  </div>

  <!-- ======== DISPLAY (per-slot tabs with rotation / translation / scale) ======== -->
  <div class="oc-section" style="padding:10px 12px;">
    <div class="oc-section-head" style="margin-bottom:8px;">
      <i class="material-icons">view_in_ar</i>
      <span>{{t('section_display')}}</span>
    </div>

    <div class="oc-display-tabs">
      <button :class="['oc-display-tab', {active: displayTab==='third'}]"  @click="displayTab='third'" :title="t('tab_third')"><i class="material-icons">person</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='left'}]"   @click="displayTab='left'" :title="t('tab_left')"><i class="material-icons">pan_tool</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='fpr'}]"    @click="displayTab='fpr'" :title="t('tab_fpr')"><i class="material-icons">front_hand</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='fpl'}]"    @click="displayTab='fpl'" :title="t('tab_fpl')"><i class="material-icons">back_hand</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='head'}]"   @click="displayTab='head'" :title="t('tab_head')"><i class="material-icons">face</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='gui'}]"    @click="displayTab='gui'" :title="t('tab_gui')"><i class="material-icons">grid_view</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='ground'}]" @click="displayTab='ground'" :title="t('tab_ground')"><i class="material-icons">download</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='fixed'}]"  @click="displayTab='fixed'" :title="t('tab_fixed')"><i class="material-icons">crop_square</i></button>
      <button :class="['oc-display-tab', {active: displayTab==='shelf'}]"  @click="displayTab='shelf'" :title="t('tab_shelf')"><i class="material-icons">shelves</i></button>
    </div>

    <!-- Issue #10: BB's real renderer cannot live in a modal dialog (it renders
         blank), so instead of an in-dialog 3D preview we drive Blockbench's own
         native Display editor. The button writes the dialog's current per-slot
         transforms into BB and opens its Display editor on the active slot. -->
    <!-- oc-tour-preview: tour anchor (issue #4) — kept on this cell -->
    <div class="oc-display-preview oc-tour-preview">
      <button type="button" class="oc-open-display-btn"
              :disabled="!displayModeAvailable"
              @click="openInDisplayEditor"
              :title="help('displayPreview')">
        <i class="material-icons">view_in_ar</i>
        <span>{{t('open_display_editor')}}</span>
      </button>
      <div class="oc-display-preview-note">{{ displayModeAvailable ? t('open_display_note') : t('open_display_disabled') }}</div>
    </div>

    <!-- 3-е лицо (thirdperson) -->
    <!-- oc-tour-thirdrow: tour anchor (issue #4) — on the WHOLE 3rd-person panel
         so the transform step spotlights all three rows (rotation/translation/scale) -->
    <div v-show="displayTab==='third'" class="oc-tour-thirdrow">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dThirdRX',1)"><input v-model.number="dThirdRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dThirdRY',1)"><input v-model.number="dThirdRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dThirdRZ',1)"><input v-model.number="dThirdRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dThirdTX',0.5)"><input v-model.number="dThirdTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dThirdTY',0.5)"><input v-model.number="dThirdTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dThirdTZ',0.5)"><input v-model.number="dThirdTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dThirdSX',0.05)"><input v-model.number="dThirdSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dThirdSY',0.05)"><input v-model.number="dThirdSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dThirdSZ',0.05)"><input v-model.number="dThirdSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- 3-е лицо ЛЕВАЯ рука (thirdperson_lefthand) — own tab. The "mirror right
         hand" toggle stays here: off = mirrors thirdperson right (default). -->
    <div v-show="displayTab==='left'">
      <label class="oc-checkbox-row" :title="t('help_useSeparateLefthand')" style="margin-bottom:8px;display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" v-model="useSeparateLefthand"/>
        <span>{{t('lbl_separate_lefthand')}}</span>
      </label>
      <div v-if="!useSeparateLefthand" style="color:#888;font-size:calc(12px * var(--oc-scale));padding:4px 2px;">
        {{t('lbl_mirrors_right')}}
      </div>
      <div v-else>
        <div class="oc-xyz-row">
          <span>{{t('lbl_rotation')}}</span>
          <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dLeftRX',1)"><input v-model.number="dLeftRX" type="number" step="1"/></div>
          <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dLeftRY',1)"><input v-model.number="dLeftRY" type="number" step="1"/></div>
          <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dLeftRZ',1)"><input v-model.number="dLeftRZ" type="number" step="1"/></div>
        </div>
        <div class="oc-xyz-row">
          <span>{{t('lbl_translation')}}</span>
          <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dLeftTX',0.5)"><input v-model.number="dLeftTX" type="number" step="0.5"/></div>
          <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dLeftTY',0.5)"><input v-model.number="dLeftTY" type="number" step="0.5"/></div>
          <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dLeftTZ',0.5)"><input v-model.number="dLeftTZ" type="number" step="0.5"/></div>
        </div>
        <div class="oc-xyz-row">
          <span>{{t('lbl_display_scale')}}</span>
          <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dLeftSX',0.05)"><input v-model.number="dLeftSX" type="number" step="0.05"/></div>
          <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dLeftSY',0.05)"><input v-model.number="dLeftSY" type="number" step="0.05"/></div>
          <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dLeftSZ',0.05)"><input v-model.number="dLeftSZ" type="number" step="0.05"/></div>
        </div>
      </div>
    </div>

    <!-- 1-е лицо правое (firstperson_righthand) -->
    <div v-show="displayTab==='fpr'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFprRX',1)"><input v-model.number="dFprRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFprRY',1)"><input v-model.number="dFprRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFprRZ',1)"><input v-model.number="dFprRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFprTX',0.5)"><input v-model.number="dFprTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFprTY',0.5)"><input v-model.number="dFprTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFprTZ',0.5)"><input v-model.number="dFprTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFprSX',0.05)"><input v-model.number="dFprSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFprSY',0.05)"><input v-model.number="dFprSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFprSZ',0.05)"><input v-model.number="dFprSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- 1-е лицо левое (firstperson_lefthand) -->
    <div v-show="displayTab==='fpl'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFplRX',1)"><input v-model.number="dFplRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFplRY',1)"><input v-model.number="dFplRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFplRZ',1)"><input v-model.number="dFplRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFplTX',0.5)"><input v-model.number="dFplTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFplTY',0.5)"><input v-model.number="dFplTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFplTZ',0.5)"><input v-model.number="dFplTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFplSX',0.05)"><input v-model.number="dFplSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFplSY',0.05)"><input v-model.number="dFplSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFplSZ',0.05)"><input v-model.number="dFplSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- Голова -->
    <div v-show="displayTab==='head'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dHeadRX',1)"><input v-model.number="dHeadRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dHeadRY',1)"><input v-model.number="dHeadRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dHeadRZ',1)"><input v-model.number="dHeadRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dHeadTX',0.5)"><input v-model.number="dHeadTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dHeadTY',0.5)"><input v-model.number="dHeadTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dHeadTZ',0.5)"><input v-model.number="dHeadTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dHeadSX',0.05)"><input v-model.number="dHeadSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dHeadSY',0.05)"><input v-model.number="dHeadSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dHeadSZ',0.05)"><input v-model.number="dHeadSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- Инвентарь (gui) -->
    <div v-show="displayTab==='gui'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGuiRX',1)"><input v-model.number="dGuiRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGuiRY',1)"><input v-model.number="dGuiRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGuiRZ',1)"><input v-model.number="dGuiRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGuiTX',0.5)"><input v-model.number="dGuiTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGuiTY',0.5)"><input v-model.number="dGuiTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGuiTZ',0.5)"><input v-model.number="dGuiTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGuiSX',0.05)"><input v-model.number="dGuiSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGuiSY',0.05)"><input v-model.number="dGuiSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGuiSZ',0.05)"><input v-model.number="dGuiSZ" type="number" step="0.05"/></div>
      </div>
      <div class="oc-xyz-row" :title="help('guiPivot')">
        <span>{{t('lbl_gui_pivot')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGuiPX',0.5)"><input v-model.number="dGuiPX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGuiPY',0.5)"><input v-model.number="dGuiPY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGuiPZ',0.5)"><input v-model.number="dGuiPZ" type="number" step="0.5"/></div>
      </div>
    </div>

    <!-- Земля -->
    <div v-show="displayTab==='ground'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGroundRX',1)"><input v-model.number="dGroundRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGroundRY',1)"><input v-model.number="dGroundRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGroundRZ',1)"><input v-model.number="dGroundRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGroundTX',0.5)"><input v-model.number="dGroundTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGroundTY',0.5)"><input v-model.number="dGroundTY" type="number" step="0.5" :data-tip="t('ground_y_tip')"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGroundTZ',0.5)"><input v-model.number="dGroundTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dGroundSX',0.05)"><input v-model.number="dGroundSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dGroundSY',0.05)"><input v-model.number="dGroundSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dGroundSZ',0.05)"><input v-model.number="dGroundSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- Рамка (fixed) -->
    <div v-show="displayTab==='fixed'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFixedRX',1)"><input v-model.number="dFixedRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFixedRY',1)"><input v-model.number="dFixedRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFixedRZ',1)"><input v-model.number="dFixedRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFixedTX',0.5)"><input v-model.number="dFixedTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFixedTY',0.5)"><input v-model.number="dFixedTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFixedTZ',0.5)"><input v-model.number="dFixedTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dFixedSX',0.05)"><input v-model.number="dFixedSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dFixedSY',0.05)"><input v-model.number="dFixedSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dFixedSZ',0.05)"><input v-model.number="dFixedSZ" type="number" step="0.05"/></div>
      </div>
    </div>

    <!-- Полка (on_shelf) -->
    <div v-show="displayTab==='shelf'">
      <div class="oc-xyz-row">
        <span>{{t('lbl_rotation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dShelfRX',1)"><input v-model.number="dShelfRX" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dShelfRY',1)"><input v-model.number="dShelfRY" type="number" step="1"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dShelfRZ',1)"><input v-model.number="dShelfRZ" type="number" step="1"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_translation')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dShelfTX',0.5)"><input v-model.number="dShelfTX" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dShelfTY',0.5)"><input v-model.number="dShelfTY" type="number" step="0.5"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dShelfTZ',0.5)"><input v-model.number="dShelfTZ" type="number" step="0.5"/></div>
      </div>
      <div class="oc-xyz-row">
        <span>{{t('lbl_display_scale')}}</span>
        <div class="oc-xyz-input oc-x" @mousedown="startDrag($event,'dShelfSX',0.05)"><input v-model.number="dShelfSX" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-y" @mousedown="startDrag($event,'dShelfSY',0.05)"><input v-model.number="dShelfSY" type="number" step="0.05"/></div>
        <div class="oc-xyz-input oc-z" @mousedown="startDrag($event,'dShelfSZ',0.05)"><input v-model.number="dShelfSZ" type="number" step="0.05"/></div>
      </div>
    </div>

  </div>

  <!-- ======== BEHAVIOR (animation + color + advanced merged) ======== -->
  <div class="oc-section" style="padding:10px 12px;">
    <div class="oc-section-head" style="margin-bottom:8px;">
      <i class="material-icons">tune</i>
      <span>{{t('section_behavior')}}</span>
    </div>

    <!-- Animation sub-section -->
    <!-- oc-tour-animation: tour anchor (issue #4) — on BOTH branches so the
         visible one is always found regardless of whether the project has anims -->
    <div v-if="hasAnims" class="oc-tour-animation" style="display:flex;align-items:center;gap:8px;">
      <label style="font-weight:600;color:#ddd;display:inline-flex;align-items:center;gap:6px;flex:1;">
        <input v-model="animationEnabled" type="checkbox"/>
        <span>{{t('section_animation')}}</span><span class="oc-help" :data-tip="help('animationEnabled')">?</span>
      </label>
    </div>
    <div v-else class="oc-tour-animation" style="display:flex;align-items:center;gap:8px;color:#777;font-size:calc(12px * var(--oc-scale));">
      <i class="material-icons" style="font-size:calc(18px * var(--oc-scale));color:#555;">play_disabled</i>
      <span>{{t('no_animations')}}</span>
    </div>

    <div v-if="hasAnims && animationEnabled" style="margin-top:10px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:grid;grid-template-columns:1fr 80px;gap:8px;">
        <!-- oc-tour-animselect: tour anchor (issue #4) — on the animation clip select -->
        <label class="oc-tour-animselect" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_animation')}}</span>
          <select v-model="animationIndex" @change="onAnimChange" style="padding:4px 6px;">
            <option v-for="a in animOptions" :key="a.value" :value="a.value">{{a.label}}</option>
          </select>
        </label>
        <!-- oc-tour-fps: tour anchor (issue #4) — on the FPS field -->
        <label class="oc-tour-fps" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;">
          <span>FPS<span class="oc-help" :data-tip="help('animFps')">?</span></span>
          <input v-model.number="animFps" type="number" min="1" max="60" :class="hasErr('animFps') ? 'oc-err' : ''"/>
          <span v-if="hasErr('animFps')" class="oc-err-msg">{{fieldErrorMap.animFps}}</span>
        </label>
      </div>
      <!-- oc-tour-range: tour anchor (issue #4) — on the Start/End range row -->
      <div class="oc-tour-range" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_start')}}<span class="oc-help" :data-tip="help('animRange')">?</span></span>
          <input v-model.number="animStart" type="number" step="0.05"/>
        </label>
        <label style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_end')}}</span>
          <input v-model.number="animEnd" type="number" step="0.05" :class="hasErr('animEnd') ? 'oc-err' : ''"/>
          <span v-if="hasErr('animEnd')" class="oc-err-msg">{{fieldErrorMap.animEnd}}</span>
        </label>
      </div>
      <div v-if="frameCountPreview" class="oc-frame-chip">
        <i class="material-icons">movie</i>
        <span>{{frameCountPreview}} · {{t('lbl_duration')}} {{durationTicksAuto}} {{tPlural(durationTicksAuto,'ticks')}}</span>
      </div>
      <!-- oc-tour-autoplay: tour anchor (issue #4) — keep on the autoplay row -->
      <label class="oc-tour-autoplay" style="display:inline-flex;align-items:center;gap:6px;font-size:calc(12px * var(--oc-scale));">
        <input v-model="autoplay" type="checkbox" :disabled="generateDatapack"/>
        <span>{{t('lbl_autoplay')}}</span><span class="oc-help" :data-tip="help('autoplay')">?</span>
      </label>

      <!-- Datapack sub-block -->
      <!-- oc-tour-datapack: tour anchor (issue #4) — keep on the datapack block -->
      <div v-if="showDatapackOption" class="oc-tour-datapack" style="margin-top:2px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.1);">
        <label style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:#ddd;">
          <input v-model="generateDatapack" type="checkbox"/>
          <i class="material-icons" style="font-size:calc(16px * var(--oc-scale));color:#5a8cc0;">terminal</i>
          <span>{{t('lbl_datapack')}}</span>
          <span class="oc-help" :data-tip="help('generateDatapack')">?</span>
        </label>

        <div v-if="generateDatapack" style="margin-top:8px;font-size:calc(12px * var(--oc-scale));display:flex;flex-direction:column;gap:8px;">
          <div style="color:#daa520;background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.2);padding:6px 9px;border-radius:4px;line-height:1.45;display:flex;gap:6px;">
            <i class="material-icons" style="font-size:calc(14px * var(--oc-scale));margin-top:2px;flex-shrink:0;">info</i>
            <span>{{t('datapack_info')}}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <!-- oc-tour-datapackid: tour anchor (issue #4) — wraps anim id + namespace
                 so the step spotlights both fields, not just one -->
            <div class="oc-tour-datapackid" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <label style="color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <span>{{t('lbl_anim_id')}}<span class="oc-help" :data-tip="help('datapackAnimId')">?</span></span>
                <input v-model="datapackAnimId" placeholder="anim" maxlength="12" :class="hasErr('datapackAnimId') ? 'oc-err' : ''"/>
                <span v-if="hasErr('datapackAnimId')" class="oc-err-msg">{{fieldErrorMap.datapackAnimId}}</span>
              </label>
              <label style="color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <span>{{t('lbl_namespace')}}<span class="oc-help" :data-tip="help('datapackNamespace')">?</span></span>
                <input v-model="datapackNamespace" placeholder="objcubed" :class="hasErr('datapackNamespace') ? 'oc-err' : ''"/>
                <span v-if="hasErr('datapackNamespace')" class="oc-err-msg">{{fieldErrorMap.datapackNamespace}}</span>
              </label>
            </div>
            <!-- oc-tour-datapacktarget: tour anchor (issue #4) — wraps target + slot -->
            <div class="oc-tour-datapacktarget" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <label style="color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <span>{{t('lbl_target')}}<span class="oc-help" :data-tip="help('datapackTargetType')">?</span></span>
                <select v-model="datapackTargetType" style="padding:4px 6px;">
                  <option value="equipment">{{t('opt_equipment')}}</option>
                  <option value="item_display">{{t('opt_item_display')}}</option>
                  <option value="player">{{t('opt_player')}}</option>
                </select>
              </label>
              <label v-if="datapackTargetType !== 'item_display'" style="color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <span>{{t('lbl_slot')}}<span class="oc-help" :data-tip="help('datapackEquipSlot')">?</span></span>
                <select v-model="datapackEquipSlot" style="padding:4px 6px;">
                  <option value="mainhand">{{t('opt_mainhand')}}</option>
                  <option value="offhand">{{t('opt_offhand')}}</option>
                  <option value="head">{{t('opt_head')}}</option>
                  <option value="chest">{{t('opt_chest')}}</option>
                  <option value="legs">{{t('opt_legs')}}</option>
                  <option value="feet">{{t('opt_feet')}}</option>
                </select>
              </label>
            </div>
            <label style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
              <span>{{t('lbl_datapack_dir')}}<span class="oc-help" :data-tip="help('datapackOutputDir')">?</span></span>
              <div style="display:flex;gap:6px;">
                <input v-model="datapackOutputDir" style="flex:1;min-width:0;" :placeholder="t('placeholder_near_png')"/>
                <button class="oc-btn oc-icon-btn" style="width:24px;height:24px;min-width:24px;min-height:24px;max-width:24px;max-height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;overflow:hidden;" @click="browseDatapackDir" :data-tip="t('tip_browse_folder')"><i class="material-icons">folder_open</i></button>
              </div>
            </label>
          </div>
          <div v-if="datapackTargetType === 'player'" style="color:#c90;font-size:calc(11px * var(--oc-scale));">
            {{t('player_note')}}
          </div>
          <div style="color:#777;font-size:calc(11px * var(--oc-scale));line-height:1.5;">
            {{t('datapack_funcs')}}<br/>
            <span class="oc-mono-wrap" style="color:#aaa;">execute as @e[…] run function {{datapackNamespace}}:{{datapackAnimId}}/play</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Separator -->
    <div style="border-top:1px solid rgba(255,255,255,0.06);margin:12px 0;"></div>

    <!-- Output sub-section -->
    <div style="margin-bottom:10px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:calc(12px * var(--oc-scale));">
        <!-- oc-tour-respack: tour anchor (issue #4) — keep on the resource-pack dir row -->
        <label class="oc-tour-respack" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_respack_dir')}}<span class="oc-help" :data-tip="help('respack_dir')">?</span></span>
          <div style="display:flex;gap:6px;">
            <input v-model="resourcePackDir" style="flex:1;min-width:0;" placeholder="…/resourcepacks/MyPack"/>
            <button class="oc-btn oc-icon-btn" style="width:24px;height:24px;min-width:24px;min-height:24px;max-width:24px;max-height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;overflow:hidden;" @click="browseResourcePackDir" :data-tip="t('tip_browse_folder')"><i class="material-icons">folder_open</i></button>
          </div>
        </label>
        <!-- oc-tour-baseitem: tour anchor (issue #4) — on the base item field -->
        <label class="oc-tour-baseitem" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_base_item')}}<span class="oc-help" :data-tip="help('base_item')">?</span></span>
          <input v-model="baseItem" placeholder="iron_ingot"/>
        </label>
        <!-- oc-tour-cmdname: tour anchor (issue #4) — on the custom_model_data name field -->
        <label class="oc-tour-cmdname" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_cmd_name')}}<span class="oc-help" :data-tip="help('cmd_name')">?</span></span>
          <input v-model="cmdName" placeholder="my_model"/>
        </label>

        <!-- Equipment (armor) export — Approach C -->
        <!-- oc-tour-equipment: tour anchor (issue #4) — keep on the equipment toggle -->
        <label class="oc-tour-equipment" style="grid-column:1/-1;display:inline-flex;align-items:center;gap:6px;font-size:calc(12px * var(--oc-scale));">
          <input v-model="exportAsEquipment" type="checkbox"/>
          <span>{{t('lbl_export_equipment')}}</span>
          <span class="oc-help" :data-tip="help('equipment')">?</span>
        </label>
        <label v-if="exportAsEquipment" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_equip_pieces')}}<span class="oc-help" :data-tip="help('equip_pieces')">?</span></span>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <label style="display:flex;gap:4px;align-items:center;color:#ccc;"><input type="checkbox" v-model="selectedPieces" value="helmet"/>{{t('opt_piece_helmet')}}</label>
            <label style="display:flex;gap:4px;align-items:center;color:#ccc;"><input type="checkbox" v-model="selectedPieces" value="chestplate"/>{{t('opt_piece_chestplate')}}</label>
            <label style="display:flex;gap:4px;align-items:center;color:#ccc;"><input type="checkbox" v-model="selectedPieces" value="leggings"/>{{t('opt_piece_leggings')}}</label>
            <label style="display:flex;gap:4px;align-items:center;color:#ccc;"><input type="checkbox" v-model="selectedPieces" value="boots"/>{{t('opt_piece_boots')}}</label>
          </div>
        </label>
        <!-- oc-tour-equipslot: legacy single-part slot — shown only when NO pieces are checked -->
        <label v-if="exportAsEquipment && !selectedPieces.length" class="oc-tour-equipslot" style="color:#aaa;grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_equip_slot')}}</span>
          <select v-model="equipmentSlot" style="padding:4px 6px;">
            <option value="head">{{t('opt_head')}}</option>
            <option value="chest">{{t('opt_chest')}}</option>
            <option value="right_arm">{{t('opt_right_arm')}}</option>
            <option value="left_arm">{{t('opt_left_arm')}}</option>
            <option value="legs">{{t('opt_legs')}}</option>
            <option value="right_leg">{{t('opt_right_leg')}}</option>
            <option value="left_leg">{{t('opt_left_leg')}}</option>
            <option value="feet">{{t('opt_feet')}}</option>
            <option value="right_foot">{{t('opt_right_foot')}}</option>
            <option value="left_foot">{{t('opt_left_foot')}}</option>
          </select>
        </label>
      </div>
    </div>

    <!-- Separator -->
    <div style="border-top:1px solid rgba(255,255,255,0.06);margin:12px 0;"></div>

    <!-- Color & Tinting sub-section -->
    <!-- oc-tour-color: tour anchor (issue #4) — keep on the Color & Tinting block -->
    <div class="oc-tour-color" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600;color:#ddd;font-size:calc(12px * var(--oc-scale));">
        <span>{{t('section_color')}}</span>
        <span class="oc-help" :data-tip="help('cb_general')">?</span>
      </div>
      <div v-if="!colorBehaviorForcedByDatapack">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <button v-for="cn in [{k:'cbR',col:'#d44'},{k:'cbG',col:'#4d4'},{k:'cbB',col:'#48f'}]" :key="cn.k"
                  class="oc-cb-btn"
                  @click="cycleCb(cn.k)"
                  :style="{border:'1px solid '+cn.col}">
            <span class="oc-cb-letter" :style="{color:cn.col}">{{cn.k.slice(-1)}}</span>
            <span class="oc-cb-value">{{cbLabel($data[cn.k])}}</span>
          </button>
        </div>
      </div>
      <div v-else style="color:#777;font-size:calc(12px * var(--oc-scale));">
        {{t('section_color')}} — {{t('color_datapack_note')}}.
      </div>
    </div>

    <!-- Separator -->
    <div style="border-top:1px solid rgba(255,255,255,0.06);margin:12px 0;"></div>

    <!-- Advanced sub-section -->
    <div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600;color:#ddd;font-size:calc(12px * var(--oc-scale));">
        <span>{{t('section_advanced')}}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
        <!-- oc-tour-easing: tour anchor (issue #4) — on the easing select only -->
        <label class="oc-tour-easing" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_easing')}}<span class="oc-help" :data-tip="help('easing')">?</span></span>
          <select v-model="easing" style="padding:4px 6px;">
            <option :value="0">{{t('opt_none')}}</option>
            <option :value="1">{{t('opt_linear')}}</option>
            <option :value="2">{{t('opt_cubic')}}</option>
            <option :value="3">{{t('opt_bezier')}}</option>
          </select>
        </label>
        <!-- oc-tour-interpolation: tour anchor (issue #4) — on the interpolation select -->
        <label class="oc-tour-interpolation" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_interpolation')}}<span class="oc-help" :data-tip="help('interpolation')">?</span></span>
          <select v-model="interpolation" style="padding:4px 6px;">
            <option :value="0">{{t('opt_none')}}</option>
            <option :value="1">{{t('opt_linear')}}</option>
          </select>
        </label>
        <!-- oc-tour-autorotate: tour anchor (issue #4) — on the autorotate select -->
        <label class="oc-tour-autorotate" style="font-size:calc(12px * var(--oc-scale));color:#aaa;display:flex;flex-direction:column;gap:3px;min-width:0;">
          <span>{{t('lbl_autorotate')}}<span class="oc-help" :data-tip="help('autorotate')">?</span></span>
          <select v-model="autorotate" style="padding:4px 6px;">
            <option :value="0">{{t('opt_off')}}</option>
            <option :value="1">{{t('opt_horizontal')}}</option>
            <option :value="2">{{t('opt_vertical')}}</option>
            <option :value="3">{{t('opt_both')}}</option>
          </select>
        </label>
      </div>
      <!-- oc-tour-flags: tour anchor (issue #4) — on the no-shadow / flip-uv / no-pow flags row -->
      <div class="oc-tour-flags" style="display:flex;flex-wrap:wrap;gap:10px 18px;">
        <label style="display:inline-flex;align-items:center;gap:6px;"><input v-model="noshadow" type="checkbox"/> <span>{{t('lbl_noshadow')}}</span><span class="oc-help" :data-tip="help('noshadow')">?</span></label>
        <label style="display:inline-flex;align-items:center;gap:6px;"><input v-model="flipuv" type="checkbox"/> <span>{{t('lbl_flipuv')}}</span><span class="oc-help" :data-tip="help('flipuv')">?</span></label>
        <label style="display:inline-flex;align-items:center;gap:6px;"><input v-model="nopow" type="checkbox"/> <span>{{t('lbl_nopow')}}</span><span class="oc-help" :data-tip="help('nopow')">?</span></label>
        <!-- filterArmature is now automatic -->
      </div>
    </div>
  </div>

  <!-- ======== FOOTER ======== -->
  <div v-if="validationErrors.length || status"
       class="oc-footer-sticky"
       style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-top:1px solid rgba(255,255,255,0.06);">
    <span v-if="validationErrors.length" class="oc-err-badge" :data-tip="errorBadgeTitle" @click="scrollToFirstError" style="cursor:pointer;">
      {{validationErrors.length}} {{tPlural(validationErrors.length, 'problems')}}
    </span>
    <span :style="{color: statusKind==='error'?'#f66' : statusKind==='done'?'#6f6' : statusKind==='cancelled'?'#fa6' : '#aaa', fontSize:'12px', flex:1, textAlign:'right'}">
      {{status}}
    </span>
  </div>

  <!-- ======== GUIDED TOUR OVERLAY (issue #4) ======== -->
  <!-- Single spotlight engine: a box-shadow "hole" positioned over the current
       step's target (its box-shadow IS the dim; its transparent center reveals
       the bright target), plus a narrating card. No separate full-screen dim —
       that would cover the target. Close via the card Skip/Got it buttons.
       positionTour() drives the geometry; tourSteps[tourIndex] the copy. -->
  <div v-if="tourActive" class="oc-tour-layer">
    <div id="oc-tour-hole" class="oc-tour-hole"></div>
    <div id="oc-tour-card" class="oc-tour-card">
      <div class="oc-tour-card-title">{{t(tourSteps[tourIndex].titleKey)}}</div>
      <div class="oc-tour-card-body">{{t(tourSteps[tourIndex].bodyKey)}}</div>
      <div class="oc-tour-card-foot">
        <span class="oc-tour-counter">{{t('tour_step').replace('{i}', tourIndex+1).replace('{n}', tourSteps.length)}}</span>
        <span class="oc-tour-card-btns">
          <button type="button" class="oc-btn oc-tour-skip" @click="tourEnd(true)">{{t('tour_skip')}}</button>
          <button type="button" class="oc-btn" v-if="tourIndex>0" @click="tourPrev">{{t('tour_back')}}</button>
          <button type="button" class="oc-btn oc-btn-primary" @click="tourNext">{{tourIndex >= tourSteps.length-1 ? t('tour_done') : t('tour_next')}}</button>
        </span>
      </div>
    </div>
  </div>

</div>`,
            },
            // Use BlockBench's native button bar for the primary Export +
            // Close — it's the only reliably pinned-to-bottom UI in a BB
            // Dialog. Our custom footer (sticky/flex) didn't survive BB's
            // own layout in the wild.
            buttons: [t('btn_export'), t('btn_close')],
            confirmIndex: 0,
            cancelIndex: 1,
            onConfirm: function () {
                const vm = this.content_vue;
                if (!vm) return;
                // Re-entrancy guard: the button stays clickable (we return false to keep the
                // dialog open), so without this a second click during an in-flight export
                // launches a concurrent run racing on the same files/status.
                if (vm.running) return false;
                if (vm.validationErrors.length) {
                    vm.scrollToFirstError();
                    return false;  // keep dialog open
                }
                vm.doExport();
                return false;  // keep open so user can see status / re-export
            },
        });

        dialog.show();
    }

    // =========================================================
    // Plugin Registration (at end of IIFE — see note near top of file)
    // =========================================================
    BBPlugin.register(PLUGIN_ID, {
        title: 'obj³',
        author: 'JagerMeistars, fork of Godlander\'s objmc',
        description: 'Export the current model with obj³ encoding for Minecraft resource packs',
        icon: 'icon',
        version: '0.5.83',
        min_version: '4.8.0',
        variant: 'desktop',
        onload() {
            this.exportAction = new Action(PLUGIN_ID + '_export', {
                name: 'Export as obj³…',
                description: 'Encode current model + texture into objcubed format',
                icon: 'icon',
                click: showDialog,
            });
            MenuBar.addAction(this.exportAction, 'file.export');

            this.emissivePropCube = new Property(Cube, 'number', 'objcubed_light_emission', {
                default: 0,
            });
            if (typeof Mesh !== 'undefined') {
                this.emissivePropMesh = new Property(Mesh, 'number', 'objcubed_light_emission', {
                    default: 0,
                });
            }
            this._emissiveMenuItem = {
                name: t('menu_toggle_emissive'),
                icon: 'light_mode',
                condition: () => (OutlinerElement.selected || []).length > 0,
                click() {
                    const sel = OutlinerElement.selected || [];
                    if (!sel.length) return;
                    const anyOn = sel.some(el => el.objcubed_light_emission > 0);
                    const newVal = anyOn ? 0 : 15;
                    Undo.initEdit({ elements: sel });
                    sel.forEach(el => { el.objcubed_light_emission = newVal; });
                    Undo.finishEdit(t(newVal ? 'undo_emissive_on' : 'undo_emissive_off'));
                    Blockbench.showQuickMessage(t(newVal ? 'toast_emissive_on' : 'toast_emissive_off'), 1000);
                },
            };
            Cube.prototype.menu.structure.unshift(this._emissiveMenuItem);
            if (typeof Mesh !== 'undefined') Mesh.prototype.menu.structure.unshift(this._emissiveMenuItem);

            // Per-piece armor: tag a GROUP (bone) with the body part its geometry rides,
            // via right-click "obj³: Body part ▸ …" (mirrors the emissive toggle). The
            // exporter reads objcubed_body_part to route each face to its part.
            if (typeof Group !== 'undefined') {
                this._bodyPartProp = new Property(Group, 'number', 'objcubed_body_part', { default: -1 });
                // [i18n key, body-part id]. Label text comes from t() so the menu and
                // its toast follow the active language.
                const OC_BODY_PARTS = [
                    ['bp_none', -1], ['bp_head', 1], ['bp_body', 0], ['bp_arm_r', 2], ['bp_arm_l', 3],
                    ['bp_leg_r', 4], ['bp_leg_l', 5], ['bp_foot_r', 6], ['bp_foot_l', 7],
                ];
                this._bodyPartMenuItem = {
                    name: t('menu_body_part'),
                    icon: 'accessibility_new',
                    condition: () => (Group.all || []).length > 0,
                    children: OC_BODY_PARTS.map(([labelKey, id]) => ({
                        name: t(labelKey),
                        click(group) {
                            // Tag ONLY the right-clicked group (avoids the "tagged
                            // everything because several groups were selected" trap).
                            const g = group || (Group.all || []).find(x => x.selected);
                            if (!g) return;
                            // {groups:[g]} snapshots the Group's registered Properties (incl.
                            // objcubed_body_part) so undo reverts the tag; {outliner:true} only
                            // captured tree structure, leaving the tag stuck after undo.
                            Undo.initEdit({ groups: [g] });
                            g.objcubed_body_part = id;
                            Undo.finishEdit(t('undo_bodypart'));
                            Blockbench.showQuickMessage(
                                t('toast_bodypart').replace('{name}', g.name).replace('{part}', t(labelKey)), 1500);
                        },
                    })),
                };
                if (Group.prototype.menu) Group.prototype.menu.structure.unshift(this._bodyPartMenuItem);
            }

            installProjectPersistence();
            installStylesheet();
        },
        onunload() {
            if (this.exportAction) this.exportAction.delete();
            if (this._emissiveMenuItem) {
                for (const cls of [Cube, typeof Mesh !== 'undefined' ? Mesh : null]) {
                    if (!cls) continue;
                    const s = cls.prototype.menu.structure;
                    const idx = s.indexOf(this._emissiveMenuItem);
                    if (idx >= 0) s.splice(idx, 1);
                }
            }
            if (this.emissivePropCube) this.emissivePropCube.delete();
            if (this.emissivePropMesh) this.emissivePropMesh.delete();
            if (this._bodyPartMenuItem && typeof Group !== 'undefined' && Group.prototype.menu) {
                const gs = Group.prototype.menu.structure;
                const gi = gs.indexOf(this._bodyPartMenuItem);
                if (gi >= 0) gs.splice(gi, 1);
            }
            if (this._bodyPartProp) this._bodyPartProp.delete();
            uninstallProjectPersistence();
            uninstallStylesheet();
        },
    });

    // ── Test hook ──────────────────────────────────────────────────────────
    // Inert inside Blockbench (the editor has no CommonJS `module` global at
    // load time). Under the Node/vitest harness this exposes the plugin's pure
    // functions for autonomous tests. See test/helpers/load-plugin.cjs.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports.__test = {
            generateDatapackFiles, buildItemSelector, mergeItemSelector, saveSingleOutput, buildOutput,
            buildSlotModelJson,
            buildVertexData, buildDisplayTransforms, hasStaticWorldDisplay,
            ensureDataRoot, loadActiveSettings, saveActiveSettings,
            computePartCenters, buildFaceToPart, collectBodyPartTags, applyBodyPartTags, parseFaceToken,
            calibratedElementsForSlot,
            buildItemTransformMatrix, activeSlotPrefixFor,
            parseObj, parseMtl, posPixels, uvPixels, vertPixels, atlasTexIndicesFrom,
            encodePNG, estimateOutputPng, t, LANG, PERSISTABLE_FIELDS,
            surfaceWarning, pluralForm, tPlural,
            UI_SCALE,
            TOUR_STEPS, TOUR_STEP_KEYS,
        };
    }

})();
