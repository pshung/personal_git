#undef NDEBUG  // asserts are the assertions here; never compile them out
#include "dispatch.hpp"
#include <cassert>
#include <cstddef>

namespace {

Event ev(EventKind k, int a, int b = 0, bool periodic = false)
{
  return Event{k, a, b, periodic};
}

void key_counts_by_codepoint_and_rejects_negative()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::KEY, 65)) == 1);
  assert(dispatch_event(q, ev(EventKind::KEY, 200)) == 2);
  assert(dispatch_event(q, ev(EventKind::KEY, -1)) == -1);
}

void mouse_counts_button_and_rejects_negative_coords()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::MOUSE, 3, 4)) == 2);
  assert(dispatch_event(q, ev(EventKind::MOUSE, 3, 0)) == 1);
  assert(dispatch_event(q, ev(EventKind::MOUSE, -1, 4)) == -1);
  assert(dispatch_event(q, ev(EventKind::MOUSE, 3, -4)) == -1);
}

void resize_queues_itself_and_rejects_non_positive()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::RESIZE, 80, 24)) == 1);
  assert(q.pending.size() == 1);
  assert(dispatch_event(q, ev(EventKind::RESIZE, 0, 24)) == -1);
  assert(dispatch_event(q, ev(EventKind::RESIZE, 80, 0)) == -1);
  assert(q.pending.size() == 1);
}

void paint_clears_pending_and_reports_whether_there_was_any()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::PAINT, 0)) == 0);
  q.pending.push_back(ev(EventKind::RESIZE, 80, 24));
  assert(dispatch_event(q, ev(EventKind::PAINT, 0)) == 1);
  assert(q.pending.empty());
}

void focus_applies_only_when_gained()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::FOCUS, 1)) == 1);
  assert(dispatch_event(q, ev(EventKind::FOCUS, 0)) == 0);
}

void timer_rearms_when_periodic()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::TIMER, 5, 0, true)) == 2);
  assert(q.pending.size() == 1);
  assert(q.pending[0].periodic);
}

void timer_fires_once_when_not_periodic()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::TIMER, 5, 0, false)) == 1);
  assert(q.pending.empty());
}

void timer_rejects_negative_payload()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::TIMER, -1, 0, true)) == -1);
  assert(q.pending.empty());
}

void shutdown_drains_pending_and_returns_the_count()
{
  Queue q;
  q.pending.push_back(ev(EventKind::RESIZE, 80, 24));
  q.pending.push_back(ev(EventKind::TIMER, 5, 0, true));
  assert(dispatch_event(q, ev(EventKind::SHUTDOWN, 0)) == 2);
  assert(q.pending.empty());
  assert(q.draining);
}

void shutdown_with_nothing_pending_drains_zero()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::SHUTDOWN, 0)) == 0);
  assert(q.draining);
}

void shutdown_rejects_negative_payload_without_draining()
{
  Queue q;
  q.pending.push_back(ev(EventKind::RESIZE, 80, 24));
  assert(dispatch_event(q, ev(EventKind::SHUTDOWN, -1)) == -1);
  assert(!q.draining);
  assert(q.pending.size() == 1);
}

void a_draining_queue_rejects_everything()
{
  Queue q;
  assert(dispatch_event(q, ev(EventKind::SHUTDOWN, 0)) == 0);
  assert(dispatch_event(q, ev(EventKind::KEY, 65)) == -1);
  assert(dispatch_event(q, ev(EventKind::TIMER, 5, 0, true)) == -1);
  assert(dispatch_event(q, ev(EventKind::SHUTDOWN, 0)) == -1);
}

void an_unknown_kind_applies_nothing()
{
  Queue q;
  assert(dispatch_event(q, ev(static_cast<EventKind>(99), 1)) == 0);
}

}  // namespace

int main()
{
  key_counts_by_codepoint_and_rejects_negative();
  mouse_counts_button_and_rejects_negative_coords();
  resize_queues_itself_and_rejects_non_positive();
  paint_clears_pending_and_reports_whether_there_was_any();
  focus_applies_only_when_gained();
  timer_rearms_when_periodic();
  timer_fires_once_when_not_periodic();
  timer_rejects_negative_payload();
  shutdown_drains_pending_and_returns_the_count();
  shutdown_with_nothing_pending_drains_zero();
  shutdown_rejects_negative_payload_without_draining();
  a_draining_queue_rejects_everything();
  an_unknown_kind_applies_nothing();
  return 0;
}
