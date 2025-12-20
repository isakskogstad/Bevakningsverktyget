#!/usr/bin/env python3
"""Send a quick SMS test via Twilio."""
import os
from twilio.rest import Client

TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_FROM = os.getenv('TWILIO_PHONE_NUMBER')
TWILIO_TO = os.getenv('TWILIO_TEST_TO')

missing = [name for name, value in (
    ('TWILIO_ACCOUNT_SID', TWILIO_ACCOUNT_SID),
    ('TWILIO_AUTH_TOKEN', TWILIO_AUTH_TOKEN),
    ('TWILIO_PHONE_NUMBER', TWILIO_FROM),
    ('TWILIO_TEST_TO', TWILIO_TO),
) if not value]
if missing:
    raise SystemExit(f"Set the following env vars (or put them in .env.local): {', '.join(missing)}")

client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
message = client.messages.create(
    body=os.getenv('TWILIO_TEST_BODY', 'Loop Impact SMS test'),
    from_=TWILIO_FROM,
    to=TWILIO_TO,
)
print('Sent SMS SID', message.sid)
