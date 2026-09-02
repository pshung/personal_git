#include "dispatch.hpp"

// Each kind's rule is a small function of its own; dispatch_event just picks one.
// The chain of `else if (e.kind == ...)` it replaces was a table written as
// control flow: every arm tested the same variable against a constant, and none
// of them shared state.
namespace {

int apply_key(Queue&, const Event& e)
{
  if (e.a < 0) return -1;
  return e.a > 127 ? 2 : 1;
}

int apply_mouse(Queue&, const Event& e)
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

int apply_paint(Queue& q, const Event&)
{
  const int applied = q.pending.empty() ? 0 : 1;
  q.pending.clear();
  return applied;
}

int apply_focus(Queue&, const Event& e)
{
  return e.a ? 1 : 0;
}

// A periodic timer re-arms itself: the re-queue is the second side effect.
int apply_timer(Queue& q, const Event& e)
{
  if (e.a < 0) return -1;
  if (!e.periodic) return 1;
  q.pending.push_back(e);
  return 2;
}

// Drains what is queued, then latches the queue closed so the top-of-dispatch
// guard rejects everything that arrives afterwards.
int apply_shutdown(Queue& q, const Event& e)
{
  if (e.a < 0) return -1;
  const int drained = static_cast<int>(q.pending.size());
  q.pending.clear();
  q.draining = true;
  return drained;
}

struct Handler {
  EventKind kind;
  int (*apply)(Queue&, const Event&);
};

constexpr Handler kHandlers[] = {
  {EventKind::KEY,      apply_key},
  {EventKind::MOUSE,    apply_mouse},
  {EventKind::RESIZE,   apply_resize},
  {EventKind::PAINT,    apply_paint},
  {EventKind::FOCUS,    apply_focus},
  {EventKind::TIMER,    apply_timer},
  {EventKind::SHUTDOWN, apply_shutdown},
};

}  // namespace

// Returns the number of side effects applied, or -1 on a rejected event.
int dispatch_event(Queue& q, const Event& e)
{
  if (q.draining) return -1;
  for (const Handler& h : kHandlers) {
    if (h.kind == e.kind) return h.apply(q, e);
  }
  return 0;
}
