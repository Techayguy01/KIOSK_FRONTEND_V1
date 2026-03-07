
import urllib.request
import json
import os

url = "http://localhost:8000/api/voice/tts"
payload = {
    "text": "Hello world, testing the premium voice.",
    "language": "en"
}
data = json.dumps(payload).encode("utf-8")
headers = {
    "Content-Type": "application/json",
    "x-tenant-slug": "grand-hotel"
}

req = urllib.request.Request(url, data=data, headers=headers, method="POST")

try:
    with urllib.request.urlopen(req) as response:
        content = response.read()
        print(f"Status: {response.status}")
        print(f"Content-Type: {response.headers.get('Content-Type')}")
        print(f"Content Length: {len(content)}")
        
        if response.status == 200:
            with open("api_voice_test_urllib.wav", "wb") as f:
                f.write(content)
            print("Saved to api_voice_test_urllib.wav")
except Exception as e:
    print(f"Request failed: {e}")
