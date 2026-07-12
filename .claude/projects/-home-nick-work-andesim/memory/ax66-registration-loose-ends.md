---
name: ax66-registration-loose-ends
description: "Post-ax66-registration open items - d23 rebuilds unregistered (guard fails), release_surface test broken pre-existing, uzobctl/sleepvalue spec escalation pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: 168d0d2b-edfc-4600-8b75-d47ba1aca28a
---

ax66_makatau-5937b880 was registered 2026-07-12 (andesim bd78b9b; vsim e23700c + d0a8328; converter f62337b). Three items remain open:

1. **d23 keeps reappearing unregistered.** The user added d23 to vsim's `config.yaml` (uncommitted there), so every full `build_vsim.sh` run recreates `sim_d23`, and andesim's registration guard then FAILS ("d23 UNREGISTERED, need d23-bd0704d1/"). Workaround used twice this session: `rm /home/nick/work/vsim_andesim/build/sim_d23`. Real fix: register d23 (chh_core family - a THIRD decoder, `andes_ip/chh_core/`) or drop it from config.yaml.

**Why:** the guard checks every BUILT engine; an unregistered binary fails the suite even if nobody runs it.
**How to apply:** if `test_registration_guard.sh` fails on d23, remove the binary or run the d23 registration ([[andes-engine-config-source]]).

2. **Pre-existing suite failure:** `tests/andes_sim/test_andes_sim_release_surface.sh` expects `andesim build` -> "unknown command", but commit ec011f4 made `run` the default command so it now parses as a run. Fails on a clean tree; needs a product decision (keep default-command and update the test, or reject unknown words).

3. **Spec escalation pending:** uzobctl (0x808) and sleepvalue (0x811) - UM164 says uzobctl exists when misa.V=1, but NO decoder generation (kv or mk) implements either; ax66 probe confirms absent. Recorded in the ax66 registration report; needs the AX6x-era SPA revision to confirm and an escalation to the spec/RTL owners.
