import urllib.request
import json

url = "http://localhost:8000/api/rooms?tenant_id=123e4567-e89b-12d3-a456-426614174000"
with open("api_out.txt", "w") as f:
    try:
        response = urllib.request.urlopen(url)
        data = response.read().decode()
        f.write("API RESPONSE:\n" + json.dumps(json.loads(data), indent=2))
    except Exception as e:
        f.write("API ERROR:\n" + str(e))
