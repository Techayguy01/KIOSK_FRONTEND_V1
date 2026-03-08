"""
agent/graph.py

The LangGraph orchestrator. This wires together all the nodes
into a single stateful conversation graph.

Flow:
  START → route_intent → [general_chat | booking_logic] → END

The "conditional edge" after route_intent reads the resolved_intent
from the state and decides which node to call next.
"""

from langgraph.graph import StateGraph, END
from agent.state import KioskState
from agent.nodes import route_intent, general_chat, booking_logic


# Intents that require booking logic
BOOKING_INTENTS = {
    "BOOK_ROOM",
    "PROVIDE_GUESTS",
    "PROVIDE_DATES",
    "PROVIDE_NAME",
    "CONFIRM_BOOKING",
    "MODIFY_BOOKING",
    "CANCEL_BOOKING",
}

# Intents that stay on the booking screen if already there
BOOKING_SCREENS = {"ROOM_SELECT", "BOOKING_COLLECT", "BOOKING_SUMMARY"}


def route_to_node(state: KioskState) -> str:
    """
    Conditional edge function: decides which node to call after intent classification.
    
    Returns the name of the next node as a string.
    """
    intent = state.resolved_intent
    screen = state.current_ui_screen

    # User is in the booking flow OR explicitly booking
    if intent in BOOKING_INTENTS or screen in BOOKING_SCREENS:
        return "booking_logic"

    return "general_chat"


def build_kiosk_graph() -> StateGraph:
    """Builds and compiles the LangGraph agent."""

    # The graph uses KioskState as its state schema.
    # Every node function receives a KioskState and returns a dict of updates.
    graph = StateGraph(KioskState)

    # Add all nodes (now async)
    graph.add_node("route_intent", route_intent)
    graph.add_node("general_chat", general_chat)
    graph.add_node("booking_logic", booking_logic)

    # Set entry point — every conversation turn starts here
    graph.set_entry_point("route_intent")

    # After classifying intent, conditionally branch to the right node
    graph.add_conditional_edges(
        "route_intent",
        route_to_node,
        {
            "general_chat": "general_chat",
            "booking_logic": "booking_logic",
        }
    )

    # Both terminal nodes go to END
    graph.add_edge("general_chat", END)
    graph.add_edge("booking_logic", END)

    return graph.compile()


# Singleton: compile once, reuse across all requests
kiosk_agent = build_kiosk_graph()
