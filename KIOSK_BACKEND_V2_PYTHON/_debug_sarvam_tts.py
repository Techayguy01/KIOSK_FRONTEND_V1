import os
from dotenv import load_dotenv
from sarvamai import SarvamAI

load_dotenv()
key = os.getenv('SARVAM_API_KEY') or os.getenv('YOUR_SARVAM_API_KEY')
print('key?', bool(key))
client = SarvamAI(api_subscription_key=key)
resp = client.text_to_speech.convert(
    text='Namaste, swagat hai',
    target_language_code='hi-IN',
    model='bulbul:v2',
    speaker='anushka',
)
print('resp type', type(resp))
if isinstance(resp, (bytes, bytearray, str)):
    print('len', len(resp))
else:
    for i, chunk in enumerate(resp):
        print('idx', i, 'type', type(chunk), 'repr', repr(chunk)[:300])
        if i >= 5:
            break
