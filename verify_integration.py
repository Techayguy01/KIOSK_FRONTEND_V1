import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_health():
    try:
        response = requests.get(f"{BASE_URL}/health")
        print(f"Health Check: {response.status_code}")
        print(response.json())
        return response.status_code == 200
    except Exception as e:
        print(f"Health Check Failed: {e}")
        return False

def test_faq_matching():
    payload = {
        "transcript": "What time is check in?",
        "sessionId": "test-session-123",
        "currentState": "WELCOME",
        "tenantId": "default",
        "faq_context": [
            {"question": "What is the check in time?", "answer": "Check in is at 2:00 PM."},
            {"question": "Do you have a pool?", "answer": "Yes, we have a pool on the 5th floor."}
        ]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/api/chat", json=payload)
        print(f"FAQ Match Status: {response.status_code}")
        data = response.json()
        print(f"Response Speech: {data.get('speech')}")
        
        # Verify deterministic matching
        if "2:00 PM" in data.get("speech", ""):
            print("✅ FAQ Context matching verified!")
        else:
            print("❌ FAQ Context matching failed or used LLM incorrectly.")
            
    except Exception as e:
        print(f"FAQ Match Failed: {e}")

if __name__ == "__main__":
    # Wait for server to be ready
    for _ in range(10):
        if test_health():
            break
        print("Waiting for server...")
        time.sleep(2)
    
    test_faq_matching()
