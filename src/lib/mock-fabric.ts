export interface AciFilterEntry {
  name: string;
  etherT: string;
  prot: string;
  dFromPort: string;
  dToPort: string;
  stateful: boolean;
}

export interface AciFilter {
  name: string;
  dn: string;
  tenant: string;
  entries: AciFilterEntry[];
}

export interface AciContractSubject {
  name: string;
  filters: string[];
}

export interface AciContract {
  name: string;
  dn: string;
  tenant: string;
  scope: "context" | "tenant" | "global" | "application-profile";
  subjects: AciContractSubject[];
  vzAnyEnabled?: boolean;
  vzAnyDirection?: "provider" | "consumer" | "both";
}

export interface AciEpg {
  name: string;
  dn: string;
  tenant: string;
  appProfile: string;
  bridgeDomain: string;
  providedContracts: string[];
  consumedContracts: string[];
  preferredGroupMember?: boolean;
}

export interface AciFault {
  code: string;
  severity: "critical" | "major" | "minor" | "warning";
  dn: string;
  tenant: string;
  descr: string;
  rule: string;
  created: string;
  affectedObject: string;
}

export interface AciTenantSnapshot {
  name: string;
  dn: string;
  descr: string;
  healthScore: number;
  vrfs: {
    name: string;
    pcEnfPref: "enforced" | "unenforced";
    vzAnyProvidedContracts: string[];
    vzAnyConsumedContracts: string[];
  }[];
  appProfiles: string[];
  epgs: AciEpg[];
  contracts: AciContract[];
  filters: AciFilter[];
  faults: AciFault[];
}

export interface SecurityViolation {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  category:
    | "VZANY_EXPOSURE"
    | "WILDCARD_FILTER"
    | "CLEARTEXT_PROTOCOL"
    | "CROSS_TENANT_LEAK"
    | "MISSING_SUBJECT"
    | "UNENFORCED_VRF"
    | "ISOLATED_EPG";
  tenant: string;
  affectedObject: string;
  dn: string;
  contractName?: string;
  filterName?: string;
  epgName?: string;
  title: string;
  description: string;
  cisBenchmark: string;
  rawAciJson: Record<string, unknown>;
  recommendedFix: {
    summary: string;
    consumerEpg: string;
    providerEpg: string;
    allowedPorts: { name: string; protocol: "tcp" | "udp"; port: string }[];
    removeVzAny: boolean;
  };
}

export const MOCK_ACI_TENANTS: AciTenantSnapshot[] = [
  {
    name: "Prod-CoreFin",
    dn: "uni/tn-Prod-CoreFin",
    descr: "Production Core Financial Banking & Payment Processing Fabric",
    healthScore: 68,
    vrfs: [
      {
        name: "Prod-Payment-VRF",
        pcEnfPref: "enforced",
        vzAnyProvidedContracts: ["Permit-All-AnyToAny"],
        vzAnyConsumedContracts: ["Permit-All-AnyToAny"],
      },
    ],
    appProfiles: ["AP-OnlineBanking", "AP-CoreLedger"],
    epgs: [
      {
        name: "Web-Frontend-EPG",
        dn: "uni/tn-Prod-CoreFin/ap-AP-OnlineBanking/epg-Web-Frontend-EPG",
        tenant: "Prod-CoreFin",
        appProfile: "AP-OnlineBanking",
        bridgeDomain: "BD-DMZ-Web",
        providedContracts: ["Web-Public-HTTP-HTTPS"],
        consumedContracts: ["App-Tier-Legacy-Access", "Permit-All-AnyToAny"],
      },
      {
        name: "Payment-App-EPG",
        dn: "uni/tn-Prod-CoreFin/ap-AP-OnlineBanking/epg-Payment-App-EPG",
        tenant: "Prod-CoreFin",
        appProfile: "AP-OnlineBanking",
        bridgeDomain: "BD-App-Internal",
        providedContracts: ["App-Tier-Legacy-Access"],
        consumedContracts: ["DB-Core-Access", "Shared-JumpHost-Export"],
      },
      {
        name: "PCI-Database-EPG",
        dn: "uni/tn-Prod-CoreFin/ap-AP-CoreLedger/epg-PCI-Database-EPG",
        tenant: "Prod-CoreFin",
        appProfile: "AP-CoreLedger",
        bridgeDomain: "BD-PCI-Vault",
        providedContracts: ["DB-Core-Access", "Permit-All-AnyToAny"],
        consumedContracts: [],
      },
      {
        name: "Audit-Logging-EPG",
        dn: "uni/tn-Prod-CoreFin/ap-AP-CoreLedger/epg-Audit-Logging-EPG",
        tenant: "Prod-CoreFin",
        appProfile: "AP-CoreLedger",
        bridgeDomain: "BD-Mgmt",
        providedContracts: [],
        consumedContracts: [],
      },
    ],
    contracts: [
      {
        name: "Permit-All-AnyToAny",
        dn: "uni/tn-Prod-CoreFin/brc-Permit-All-AnyToAny",
        tenant: "Prod-CoreFin",
        scope: "context",
        vzAnyEnabled: true,
        vzAnyDirection: "both",
        subjects: [
          {
            name: "Subj-Allow-Everything",
            filters: ["default-permit-any"],
          },
        ],
      },
      {
        name: "App-Tier-Legacy-Access",
        dn: "uni/tn-Prod-CoreFin/brc-App-Tier-Legacy-Access",
        tenant: "Prod-CoreFin",
        scope: "tenant",
        subjects: [
          {
            name: "Subj-Legacy-Mgmt-And-API",
            filters: ["Flt-Telnet-FTP-HTTP", "Flt-HTTPS-8443"],
          },
        ],
      },
      {
        name: "DB-Core-Access",
        dn: "uni/tn-Prod-CoreFin/brc-DB-Core-Access",
        tenant: "Prod-CoreFin",
        scope: "context",
        subjects: [
          {
            name: "Subj-Postgres-5432",
            filters: ["Flt-Postgres-5432"],
          },
        ],
      },
      {
        name: "Web-Public-HTTP-HTTPS",
        dn: "uni/tn-Prod-CoreFin/brc-Web-Public-HTTP-HTTPS",
        tenant: "Prod-CoreFin",
        scope: "context",
        subjects: [
          {
            name: "Subj-Web-Ingress",
            filters: ["Flt-HTTPS-443"],
          },
        ],
      },
      {
        name: "Shared-JumpHost-Export",
        dn: "uni/tn-Prod-CoreFin/brc-Shared-JumpHost-Export",
        tenant: "Prod-CoreFin",
        scope: "global",
        subjects: [
          {
            name: "Subj-Global-Leak",
            filters: ["default-permit-any"],
          },
        ],
      },
    ],
    filters: [
      {
        name: "default-permit-any",
        dn: "uni/tn-Prod-CoreFin/flt-default-permit-any",
        tenant: "Prod-CoreFin",
        entries: [
          {
            name: "entry-ip-any-any",
            etherT: "unspecified",
            prot: "unspecified",
            dFromPort: "unspecified",
            dToPort: "unspecified",
            stateful: false,
          },
        ],
      },
      {
        name: "Flt-Telnet-FTP-HTTP",
        dn: "uni/tn-Prod-CoreFin/flt-Flt-Telnet-FTP-HTTP",
        tenant: "Prod-CoreFin",
        entries: [
          {
            name: "telnet-23",
            etherT: "ip",
            prot: "tcp",
            dFromPort: "23",
            dToPort: "23",
            stateful: true,
          },
          {
            name: "ftp-21",
            etherT: "ip",
            prot: "tcp",
            dFromPort: "21",
            dToPort: "21",
            stateful: true,
          },
          {
            name: "http-80",
            etherT: "ip",
            prot: "tcp",
            dFromPort: "80",
            dToPort: "80",
            stateful: true,
          },
        ],
      },
      {
        name: "Flt-HTTPS-8443",
        dn: "uni/tn-Prod-CoreFin/flt-Flt-HTTPS-8443",
        tenant: "Prod-CoreFin",
        entries: [
          {
            name: "https-8443",
            etherT: "ip",
            prot: "tcp",
            dFromPort: "8443",
            dToPort: "8443",
            stateful: true,
          },
        ],
      },
      {
        name: "Flt-Postgres-5432",
        dn: "uni/tn-Prod-CoreFin/flt-Flt-Postgres-5432",
        tenant: "Prod-CoreFin",
        entries: [
          {
            name: "pg-5432",
            etherT: "ip",
            prot: "tcp",
            dFromPort: "5432",
            dToPort: "5432",
            stateful: true,
          },
        ],
      },
      {
        name: "Flt-HTTPS-443",
        dn: "uni/tn-Prod-CoreFin/flt-Flt-HTTPS-443",
        tenant: "Prod-CoreFin",
        entries: [
          {
            name: "https-443",
            etherT: "ip",
            prot: "tcp",
            dFromPort: "443",
            dToPort: "443",
            stateful: true,
          },
        ],
      },
    ],
    faults: [
      {
        code: "F0467",
        severity: "critical",
        dn: "uni/tn-Prod-CoreFin/ctx-Prod-Payment-VRF/any/fault-F0467",
        tenant: "Prod-CoreFin",
        descr:
          "vzAny (Any-to-Any) contract 'Permit-All-AnyToAny' attached to Prod-Payment-VRF bypasses zero-trust micro-segmentation for PCI-Database-EPG.",
        rule: "vz-any-zero-trust-violation",
        created: "2026-11-23T10:12:04Z",
        affectedObject: "uni/tn-Prod-CoreFin/brc-Permit-All-AnyToAny",
      },
      {
        code: "F1102",
        severity: "major",
        dn: "uni/tn-Prod-CoreFin/brc-App-Tier-Legacy-Access/fault-F1102",
        tenant: "Prod-CoreFin",
        descr:
          "Cleartext management protocols (Telnet TCP/23, FTP TCP/21, HTTP TCP/80) exposed between Web-Frontend-EPG and Payment-App-EPG.",
        rule: "vz-filter-cleartext-exposure",
        created: "2026-11-23T09:48:19Z",
        affectedObject: "uni/tn-Prod-CoreFin/brc-App-Tier-Legacy-Access",
      },
      {
        code: "F0931",
        severity: "warning",
        dn: "uni/tn-Prod-CoreFin/ap-AP-CoreLedger/epg-Audit-Logging-EPG/fault-F0931",
        tenant: "Prod-CoreFin",
        descr:
          "Endpoint Group 'Audit-Logging-EPG' has no provided or consumed contracts attached; syslog ingestion traffic is currently blackholed.",
        rule: "fv-epg-orphan-contract",
        created: "2026-11-23T08:15:00Z",
        affectedObject: "uni/tn-Prod-CoreFin/ap-AP-CoreLedger/epg-Audit-Logging-EPG",
      },
    ],
  },
  {
    name: "Hybrid-Cloud-AI",
    dn: "uni/tn-Hybrid-Cloud-AI",
    descr: "AI Inference Cluster & Vector Storage Interconnect Tenant",
    healthScore: 76,
    vrfs: [
      {
        name: "AI-Cluster-VRF",
        pcEnfPref: "unenforced",
        vzAnyProvidedContracts: [],
        vzAnyConsumedContracts: [],
      },
    ],
    appProfiles: ["AP-Inference-Pipeline"],
    epgs: [
      {
        name: "Groq-Gateway-EPG",
        dn: "uni/tn-Hybrid-Cloud-AI/ap-AP-Inference-Pipeline/epg-Groq-Gateway-EPG",
        tenant: "Hybrid-Cloud-AI",
        appProfile: "AP-Inference-Pipeline",
        bridgeDomain: "BD-AI-Ingress",
        providedContracts: ["Gateway-Ingress-Contract"],
        consumedContracts: ["VectorDB-WideOpen-Contract"],
      },
      {
        name: "Vector-DB-EPG",
        dn: "uni/tn-Hybrid-Cloud-AI/ap-AP-Inference-Pipeline/epg-Vector-DB-EPG",
        tenant: "Hybrid-Cloud-AI",
        appProfile: "AP-Inference-Pipeline",
        bridgeDomain: "BD-AI-Storage",
        providedContracts: ["VectorDB-WideOpen-Contract"],
        consumedContracts: [],
      },
    ],
    contracts: [
      {
        name: "Gateway-Ingress-Contract",
        dn: "uni/tn-Hybrid-Cloud-AI/brc-Gateway-Ingress-Contract",
        tenant: "Hybrid-Cloud-AI",
        scope: "context",
        subjects: [],
      },
      {
        name: "VectorDB-WideOpen-Contract",
        dn: "uni/tn-Hybrid-Cloud-AI/brc-VectorDB-WideOpen-Contract",
        tenant: "Hybrid-Cloud-AI",
        scope: "global",
        subjects: [
          {
            name: "Subj-All-Ports",
            filters: ["Flt-Wildcard-AllPorts"],
          },
        ],
      },
    ],
    filters: [
      {
        name: "Flt-Wildcard-AllPorts",
        dn: "uni/tn-Hybrid-Cloud-AI/flt-Flt-Wildcard-AllPorts",
        tenant: "Hybrid-Cloud-AI",
        entries: [
          {
            name: "tcp-any-port",
            etherT: "ip",
            prot: "tcp",
            dFromPort: "1",
            dToPort: "65535",
            stateful: false,
          },
        ],
      },
    ],
    faults: [
      {
        code: "F1520",
        severity: "critical",
        dn: "uni/tn-Hybrid-Cloud-AI/ctx-AI-Cluster-VRF/fault-F1520",
        tenant: "Hybrid-Cloud-AI",
        descr:
          "VRF 'AI-Cluster-VRF' policy control enforcement preference is set to 'unenforced' — all EPG-to-EPG traffic within VRF is permitted without contracts.",
        rule: "vz-ctx-unenforced-policy",
        created: "2026-11-23T09:59:11Z",
        affectedObject: "uni/tn-Hybrid-Cloud-AI/ctx-AI-Cluster-VRF",
      },
      {
        code: "F1299",
        severity: "major",
        dn: "uni/tn-Hybrid-Cloud-AI/brc-Gateway-Ingress-Contract/fault-F1299",
        tenant: "Hybrid-Cloud-AI",
        descr:
          "Contract 'Gateway-Ingress-Contract' has 0 subjects attached (empty contract definition).",
        rule: "vz-brc-missing-subject",
        created: "2026-11-23T09:10:44Z",
        affectedObject: "uni/tn-Hybrid-Cloud-AI/brc-Gateway-Ingress-Contract",
      },
    ],
  },
];
