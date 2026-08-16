"""Example validator: checks a proposed Google Search RSA against google_ads_specs.json.
Miles's Campaign Launcher should call something like this before any write."""
import json, sys
spec=json.load(open('google_ads_specs.json'))
rsa=spec['campaign_types']['search']['ad_units']['responsive_search_ad']

def check_text(field, items, rule):
    errs=[]
    if rule.get('required') and len(items)<rule['min_count']:
        errs.append(f"{field}: need >= {rule['min_count']}, got {len(items)}")
    if len(items)>rule['max_count']:
        errs.append(f"{field}: max {rule['max_count']}, got {len(items)}")
    for i,t in enumerate(items):
        if len(t)>rule['max_chars']:
            errs.append(f"{field}[{i}] is {len(t)} chars (max {rule['max_chars']}): '{t}'")
    return errs

def validate_rsa(ad):
    errs=[]
    if not ad.get('final_url'): errs.append("final_url required")
    errs+=check_text('headlines',ad.get('headlines',[]),rsa['headlines'])
    errs+=check_text('descriptions',ad.get('descriptions',[]),rsa['descriptions'])
    errs+=check_text('display_path',ad.get('display_path',[]),rsa['display_path'])
    return errs

if __name__=='__main__':
    sample={"final_url":"https://example.com/plumbing",
        "headlines":["24/7 Emergency Plumber","Licensed & Insured Plumbers Near You Today","Same-Day Service"],
        "descriptions":["Call now for fast, honest plumbing repair.","Upfront pricing."],
        "display_path":["plumbing","emergency"]}
    for e in validate_rsa(sample) or ["PASS"]: print(e)
