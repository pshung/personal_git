#include "dispatch.hpp"
#include <cassert>

// Each case uses its own Queue so the tests stay independent: SHUTDOWN sets
// q.draining, which would otherwise make every later dispatch return -1.
namespace {

void key_applies_once_below_128_and_twice_above()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::KEY, 65, 0, false}) == 1);
  assert(dispatch_event(q, {EventKind::KEY, 200, 0, false}) == 2);
}

void key_rejects_negative_payload()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::KEY, -1, 0, false}) == -1);
}

void mouse_counts_the_button_as_a_second_effect()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::MOUSE, 3, 4, false}) == 2);
  assert(dispatch_event(q, {EventKind::MOUSE, 3, 0, false}) == 1);
}

void mouse_rejects_negative_payload()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::MOUSE, -1, 0, false}) == -1);
  assert(dispatch_event(q, {EventKind::MOUSE, 0, -1, false}) == -1);
}

void resize_queues_the_event()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::RESIZE, 80, 24, false}) == 1);
  assert(q.pending.size() == 1);
}

void resize_rejects_non_positive_extent()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::RESIZE, 0, 24, false}) == -1);
  assert(dispatch_event(q, {EventKind::RESIZE, 80, 0, false}) == -1);
  assert(q.pending.empty());
}

void paint_clears_pending_and_reports_whether_it_had_work()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::PAINT, 0, 0, false}) == 0);
  assert(dispatch_event(q, {EventKind::RESIZE, 80, 24, false}) == 1);
  assert(dispatch_event(q, {EventKind::PAINT, 0, 0, false}) == 1);
  assert(q.pending.empty());
}

void focus_applies_only_when_set()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::FOCUS, 1, 0, false}) == 1);
  assert(dispatch_event(q, {EventKind::FOCUS, 0, 0, false}) == 0);
}

void timer_one_shot_applies_once_and_does_not_rearm()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::TIMER, 5, 0, false}) == 1);
  assert(q.pending.empty());
}

void timer_periodic_rearms_and_applies_twice()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::TIMER, 5, 0, true}) == 2);
  assert(q.pending.size() == 1);
  assert(q.pending[0].kind == EventKind::TIMER);
  assert(q.pending[0].a == 5);
  assert(q.pending[0].periodic);
}

void timer_rejects_negative_payload()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::TIMER, -1, 0, true}) == -1);
  assert(q.pending.empty());
}

void shutdown_drains_pending_and_returns_the_drained_count()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::RESIZE, 80, 24, false}) == 1);
  assert(dispatch_event(q, {EventKind::RESIZE, 90, 30, false}) == 1);
  assert(dispatch_event(q, {EventKind::SHUTDOWN, 0, 0, false}) == 2);
  assert(q.pending.empty());
  assert(q.draining);
}

void shutdown_on_an_empty_queue_drains_nothing_but_still_drains()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::SHUTDOWN, 0, 0, false}) == 0);
  assert(q.draining);
}

void shutdown_rejects_negative_payload_and_leaves_the_queue_alone()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::RESIZE, 80, 24, false}) == 1);
  assert(dispatch_event(q, {EventKind::SHUTDOWN, -1, 0, false}) == -1);
  assert(q.pending.size() == 1);
  assert(!q.draining);
}

void a_draining_queue_rejects_every_later_event()
{
  Queue q;
  assert(dispatch_event(q, {EventKind::SHUTDOWN, 0, 0, false}) == 0);
  assert(dispatch_event(q, {EventKind::KEY, 65, 0, false}) == -1);
  assert(dispatch_event(q, {EventKind::TIMER, 5, 0, true}) == -1);
  assert(dispatch_event(q, {EventKind::SHUTDOWN, 0, 0, false}) == -1);
}

// Characterisation test: the original if/else chain fell through to 0 for a
// kind it did not recognise, and the switch keeps that contract. Only reachable
// by casting a value outside the enumerator set.
void an_unknown_kind_applies_nothing()
{
  Queue q;
  assert(dispatch_event(q, {static_cast<EventKind>(99), 1, 1, false}) == 0);
  assert(q.pending.empty());
  assert(!q.draining);
}

} // namespace

int main()
{
  key_applies_once_below_128_and_twice_above();
  key_rejects_negative_payload();
  mouse_counts_the_button_as_a_second_effect();
  mouse_rejects_negative_payload();
  resize_queues_the_event();
  resize_rejects_non_positive_extent();
  paint_clears_pending_and_reports_whether_it_had_work();
  focus_applies_only_when_set();
  timer_one_shot_applies_once_and_does_not_rearm();
  timer_periodic_rearms_and_applies_twice();
  timer_rejects_negative_payload();
  shutdown_drains_pending_and_returns_the_drained_count();
  shutdown_on_an_empty_queue_drains_nothing_but_still_drains();
  shutdown_rejects_negative_payload_and_leaves_the_queue_alone();
  a_draining_queue_rejects_every_later_event();
  an_unknown_kind_applies_nothing();
  return 0;
}
