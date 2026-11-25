import { useState, useEffect, useRef, useCallback } from "react";
import { EMPTY_HAULER, withRetry, KNOWN_TRANSPORT_KEYS } from "../constants";
import api from "../../../api";

export default function usePortalBootstrap({
  companyForm, showError,
}) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [haulerDraft, setHaulerDraft] = useState({ ...EMPTY_HAULER });
  const [fieldLabels, setFieldLabels] = useState({});
  const [hazWasteCodes, setHazWasteCodes] = useState([
    "K301",
    "K302",
    "K303",
    "M501",
  ]);
  // Hauler address dropdowns
  const [haulerProvinces, setHaulerProvinces] = useState([]);
  const [haulerCities, setHaulerCities] = useState([]);
  const [haulerBarangayList, setHaulerBarangayList] = useState([]);
  const [loadingHaulerAddress, setLoadingHaulerAddress] = useState("");
  const [extraTransportFields, setExtraTransportFields] = useState([]);
  // Address cascading dropdowns
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [barangays, setBarangays] = useState([]);

  // ── Online / offline awareness ──
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Fetch portal field settings with retry ──
  const fieldsLoadedRef = useRef(false);
  const fetchFieldSettings = useCallback((signal) => {
    return withRetry(() => api.get("/settings/fields", { signal }), {
      retries: 3,
      signal,
    })
      .then(({ data }) => {
        const map = {};
        const extraTransport = [];
        data.forEach((f) => {
          map[f.fieldKey] = {
            label: f.fieldName,
            required: f.required,
            options: f.options || [],
            section: f.section,
            fieldType: f.fieldType,
          };
          if (f.section === "hazwaste-codes" && f.options?.length > 0) {
            setHazWasteCodes(f.options);
          }
          if (
            f.section === "transport-info" &&
            !KNOWN_TRANSPORT_KEYS.has(f.fieldKey) &&
            f.fieldKey !== "hazWasteCode" &&
            !f.fieldKey.toLowerCase().includes("hazwaste")
          ) {
            extraTransport.push(f);
          }
        });
        setFieldLabels(map);
        setExtraTransportFields(
          extraTransport.sort((a, b) => a.order - b.order),
        );
        fieldsLoadedRef.current = true;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchFieldSettings(ac.signal);
    return () => ac.abort();
  }, [fetchFieldSettings]);

  // ── Fetch regions with retry ──
  const regionsLoadedRef = useRef(false);
  const fetchRegions = useCallback((signal) => {
    return withRetry(() => api.get("/settings/address/regions", { signal }), {
      retries: 3,
      signal,
    })
      .then(({ data }) => {
        setRegions(data || []);
        regionsLoadedRef.current = true;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchRegions(ac.signal);
    return () => ac.abort();
  }, [fetchRegions]);

  // ── Auto-recover when coming back online ──
  useEffect(() => {
    if (!isOnline) return;
    // Re-fetch data that failed to load initially
    const ac = new AbortController();
    if (!fieldsLoadedRef.current) fetchFieldSettings(ac.signal);
    if (!regionsLoadedRef.current) fetchRegions(ac.signal);
    return () => ac.abort();
  }, [isOnline, fetchFieldSettings, fetchRegions]);

  const [loadingAddress, setLoadingAddress] = useState("");

  // `preserveSelection` = we are HYDRATING an existing record's address, not
  // reacting to the user picking a new Region. The clearing below is correct for
  // a user change (a new region invalidates the province/municipality/barangay
  // beneath it) but destructive when loading stored values: Edit & Resubmit
  // called all three cascaders straight after setFieldsValue, so the record's
  // Province, Municipality and Barangay were wiped the instant they were loaded.
  const fetchProvinces = (regionCode, { preserveSelection = false } = {}) => {
    setProvinces([]);
    if (!preserveSelection) {
      setMunicipalities([]);
      setBarangays([]);
      companyForm.setFieldsValue({
        companyProvince: undefined,
        companyMunicipality: undefined,
        companyBarangay: undefined,
      });
    }
    if (!regionCode) return;
    setLoadingAddress("province");
    withRetry(() => api.get(`/settings/address/provinces/${regionCode}`), {
      retries: 2,
    })
      .then(({ data }) => setProvinces(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load provinces. Please re-select the region.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  const fetchMunicipalities = (provinceCode, { preserveSelection = false } = {}) => {
    setMunicipalities([]);
    if (!preserveSelection) {
      setBarangays([]);
      companyForm.setFieldsValue({
        companyMunicipality: undefined,
        companyBarangay: undefined,
      });
    }
    if (!provinceCode) return;
    setLoadingAddress("municipality");
    withRetry(
      () => api.get(`/settings/address/municipalities/${provinceCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setMunicipalities(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message:
            "Could not load municipalities. Please re-select the province.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  const fetchBarangays = (municipalityCode, { preserveSelection = false } = {}) => {
    setBarangays([]);
    if (!preserveSelection) companyForm.setFieldsValue({ companyBarangay: undefined });
    if (!municipalityCode) return;
    setLoadingAddress("barangay");
    withRetry(
      () => api.get(`/settings/address/barangays/${municipalityCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setBarangays(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message:
            "Could not load barangays. Please re-select the municipality.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  // ── Hauler address fetch helpers ──
  // Helper to update multiple address fields in haulerDraft at once
  const updateHaulerDraftAddr = (fields) => {
    setHaulerDraft((prev) => ({ ...prev, ...fields }));
  };
  const fetchHaulerProvinces = (regionCode) => {
    setHaulerProvinces([]);
    setHaulerCities([]);
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({
      officeProvince: "",
      officeCity: "",
      officeBarangay: "",
    });
    if (!regionCode) return;
    setLoadingHaulerAddress("province");
    withRetry(() => api.get(`/settings/address/provinces/${regionCode}`), {
      retries: 2,
    })
      .then(({ data }) => setHaulerProvinces(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load provinces.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  const fetchHaulerCities = (provinceCode) => {
    setHaulerCities([]);
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeCity: "", officeBarangay: "" });
    if (!provinceCode) return;
    setLoadingHaulerAddress("city");
    withRetry(
      () => api.get(`/settings/address/municipalities/${provinceCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setHaulerCities(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load cities/municipalities.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  const fetchHaulerBarangays = (cityCode) => {
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeBarangay: "" });
    if (!cityCode) return;
    setLoadingHaulerAddress("barangay");
    withRetry(() => api.get(`/settings/address/barangays/${cityCode}`), {
      retries: 2,
    })
      .then(({ data }) => setHaulerBarangayList(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load barangays.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  // Helper to get field label from settings, fallback to default
  const fl = (key, fallback) => fieldLabels[key]?.label || fallback;
  // Helper: is field required per admin settings? Falls back to defaultReq.
  const isRequired = (key, defaultReq = false) =>
    fieldLabels[key] ? fieldLabels[key].required : defaultReq;
  // Helper: get select options from settings, with fallback
  const opts = (key, fallback = []) =>
    fieldLabels[key]?.options?.length > 0 ? fieldLabels[key].options : fallback;

  return {
    barangays, extraTransportFields, fetchBarangays, fetchHaulerBarangays, fetchHaulerCities,
    fetchHaulerProvinces, fetchMunicipalities, fetchProvinces, fl, haulerBarangayList, haulerCities,
    haulerDraft, haulerProvinces, hazWasteCodes, isOnline, isRequired, loadingAddress,
    loadingHaulerAddress, municipalities, opts, provinces, regions, setBarangays,
    setHaulerBarangayList, setHaulerCities, setHaulerDraft, setHaulerProvinces,
    setLoadingHaulerAddress, setMunicipalities, setProvinces, updateHaulerDraftAddr,
  };
}
