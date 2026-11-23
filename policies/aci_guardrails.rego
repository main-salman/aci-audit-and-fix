package aci.guardrails

import future.keywords.in

# ==============================================================================
# CISCO ACI ZERO-TRUST GITOPS GUARDRAILS (Open Policy Agent / Conftest)
# Enforces CIS Cisco ACI Benchmark rules on every AI-generated Terraform plan.
# ==============================================================================

# 1. Prohibit vzAny (Any-to-Any) Contract Bindings on Production VRFs
deny[msg] {
  input.vrf.vz_any_enabled == true
  msg := sprintf("BLOCKED [CIS-3.2.4]: VRF '%s' has vz_any_enabled=true. Any-to-Any (vzAny) contract bindings are prohibited.", [input.vrf.name])
}

# 2. Require VRF Policy Control Enforcement Preference = "enforced"
deny[msg] {
  input.vrf.pc_enf_pref != "enforced"
  msg := sprintf("BLOCKED [CIS-2.1.1]: VRF '%s' pc_enf_pref is '%s' — must be 'enforced'.", [input.vrf.name, input.vrf.pc_enf_pref])
}

# 3. Reject Wildcard / Unspecified Filter Protocols or Full 1-65535 Port Ranges
deny[msg] {
  some entry in input.filter.entries
  is_wildcard_entry(entry)
  msg := sprintf("BLOCKED [CIS-3.4.1]: Filter '%s' entry '%s' contains wildcard/unspecified protocol or port range (%s:%s-%s).", [
    input.filter.name,
    entry.name,
    entry.prot,
    entry.d_from_port,
    entry.d_to_port,
  ])
}

is_wildcard_entry(entry) {
  entry.ether_t == "unspecified"
}

is_wildcard_entry(entry) {
  entry.prot == "unspecified"
}

is_wildcard_entry(entry) {
  entry.d_from_port == "unspecified"
}

is_wildcard_entry(entry) {
  entry.d_from_port == "1"
  entry.d_to_port == "65535"
}

# 4. Block Cleartext Protocols (Telnet/23, FTP/21, TFTP/69, HTTP/80, SNMP/161, Syslog/514)
banned_cleartext_ports := {"21", "23", "69", "80", "161", "514"}

deny[msg] {
  some entry in input.filter.entries
  banned_cleartext_ports[entry.d_from_port]
  msg := sprintf("BLOCKED [CIS-3.4.5]: Filter '%s' entry '%s' exposes banned cleartext port %s/%s.", [
    input.filter.name,
    entry.name,
    entry.prot,
    entry.d_from_port,
  ])
}

# 5. Require Stateful Inspection on All TCP Filter Entries
deny[msg] {
  some entry in input.filter.entries
  entry.prot == "tcp"
  entry.stateful != true
  msg := sprintf("BLOCKED [CIS-3.4.2]: TCP filter entry '%s' in filter '%s' must set stateful=true.", [
    entry.name,
    input.filter.name,
  ])
}

# 6. Prevent Cross-Tenant Global Contract Scope Leaks
allowed_scopes := {"context", "tenant", "application-profile"}

deny[msg] {
  not allowed_scopes[input.contract.scope]
  msg := sprintf("BLOCKED [CIS-3.3.1]: Contract '%s' uses scope '%s'. Global scope contracts must be explicitly approved to prevent cross-tenant leakage.", [
    input.contract.name,
    input.contract.scope,
  ])
}
