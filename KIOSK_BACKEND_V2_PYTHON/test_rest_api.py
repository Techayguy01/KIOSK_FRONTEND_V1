
import urllib.request
import json
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("SARVAM_API_KEY", "").strip() or os.getenv("YOUR_SARVAM_API_KEY", "").strip()

url = "https://api.sarvam.ai/text-to-speech"
payload = {
    "text": "Namaste, this is a test of the direct REST API.",
    "target_language_code": "hi-IN",
    "speaker": "anushka",
    "model": "bulbul:v2"
}
data = json.dumps(payload).encode("utf-8")
headers = {
    "api-subscription-key": api_key,
    "Content-Type": "application/json"
}

req = urllib.request.Request(url, data=data, headers=headers, method="POST")

print(f"Calling Sarvam REST API at {url}...")
try:
    with urllib.request.urlopen(req, timeout=10) as response:
        content = response.read()
        print(f"Status: {response.status}")
        print(f"Content Length: {len(content)}")
        if response.status == 200:
            with open("rest_test_output.wav", "wb") as f:
                f.write(content)
            print("Success! Saved to rest_test_output.wav")
except Exception as e:
    print(f"Rest API failed: {e}")
