#include "dispatch.hpp"

// One handler per event kind. Handlers that do not take a Queue& are pure, so
// the signature alone tells you which kinds can mutate the queue.
// Each returns the number of side effects applied, or -1 to reject the event.
namespace {

int apply_key(const Event& e)
{
  if (e.a < 0) return -1;
  return e.a > 127 ? 2 : 1;
}

int apply_mouse(const Event& e)
{
  if (e.a < 0 || e.b < 0) return -1;
  return e.b > 0 ? 2 : 1;
}

int apply_resize(Queue& q, const Event& e)
{
  if (e.a <= 0 || e.b <= 0) return -1;
  q.pending.push_back(e);
  return 1;
}

int apply_paint(Queue& q)
{
  const int applied = q.pending.empty() ? 0 : 1;
  q.pending.clear();
  return applied;
}

int apply_focus(const Event& e)
{
  return e.a ? 1 : 0;
}

// A periodic timer re-arms itself by queueing the event again; that re-arm is
// the second side effect.
int apply_timer(Queue& q, const Event& e)
{
  if (e.a < 0) return -1;
  if (!e.periodic) return 1;
  q.pending.push_back(e);
  return 2;
}

// Drains whatever is still queued and latches the queue closed, so every later
// event is rejected by the q.draining guard in dispatch_event.
int apply_shutdown(Queue& q, const Event& e)
{
  if (e.a < 0) return -1;
  const int drained = static_cast<int>(q.pending.size());
  q.pending.clear();
  q.draining = true;
  return drained;
}

} // namespace

// Returns the number of side effects applied, or -1 on a rejected event.
int dispatch_event(Queue& q, const Event& e)
{
  if (q.draining) return -1;
  switch (e.kind) {
    case EventKind::KEY:      return apply_key(e);
    case EventKind::MOUSE:    return apply_mouse(e);
    case EventKind::RESIZE:   return apply_resize(q, e);
    case EventKind::PAINT:    return apply_paint(q);
    case EventKind::FOCUS:    return apply_focus(e);
    case EventKind::TIMER:    return apply_timer(q, e);
    case EventKind::SHUTDOWN: return apply_shutdown(q, e);
  }
  return 0;  // kind outside the enumerator set; unreachable via the public API
}
