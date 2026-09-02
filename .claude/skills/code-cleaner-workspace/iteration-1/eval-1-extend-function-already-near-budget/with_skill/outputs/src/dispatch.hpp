#pragma once
#include <vector>
enum class EventKind { KEY, MOUSE, RESIZE, PAINT, FOCUS, TIMER, SHUTDOWN };
struct Event { EventKind kind; int a; int b; bool periodic; };
struct Queue { std::vector<Event> pending; bool draining = false; };
int dispatch_event(Queue& q, const Event& e);
