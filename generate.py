import requests
import base64

USER_ID = "V1:z5frk4e2ysx4fuqm:DEVCENTER:EXT"
PASSWORD = "UmC9iTc7"

# Step 1: Base64 encode User ID
encoded_user = base64.b64encode(
    USER_ID.encode("utf-8")
).decode("utf-8")

# Step 2: Base64 encode Password
encoded_password = base64.b64encode(
    PASSWORD.encode("utf-8")
).decode("utf-8")

# Step 3: Join encoded values with :
combined = encoded_user + ":" + encoded_password

# Step 4: Base64 encode the complete string
authorization = base64.b64encode(
    combined.encode("utf-8")
).decode("utf-8")

url = "https://api-crt.cert.havail.sabre.com/v2/auth/token"

headers = {
    "Authorization": "Basic " + authorization,
    "Content-Type": "application/x-www-form-urlencoded"
}

data = {
    "grant_type": "client_credentials"
}

response = requests.post(
    url,
    headers=headers,
    data=data
)

print("Status:", response.status_code)
print(response.text)