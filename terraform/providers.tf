terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aci = {
      source  = "CiscoDevNet/aci"
      version = "~> 2.13.0"
    }
  }
}

variable "apic_url" {
  description = "Cisco APIC Controller URL (defaults to Cisco DevNet Always-On Sandbox)"
  type        = string
  default     = "https://sandboxapicdc.cisco.com"
}

variable "apic_username" {
  description = "Cisco APIC Username"
  type        = string
  default     = "admin"
}

variable "apic_password" {
  description = "Cisco APIC Password"
  type        = string
  sensitive   = true
  default     = "!v3G@!4@Y"
}

provider "aci" {
  url      = var.apic_url
  username = var.apic_username
  password = var.apic_password
  insecure = true
}
