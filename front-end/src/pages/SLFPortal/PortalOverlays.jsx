import { Modal, Space, DatePicker, Tour, Progress } from "antd";
import { ClockCircleOutlined, SendOutlined } from "@ant-design/icons";
import { Text } from "./portalShared";
import dayjs from "dayjs";

export default function PortalOverlays({
  activeTab, dismissTourPermanently, featureTourCurrent, featureTourOpen, featureTourSteps,
  handleScheduleSubmission, markFeatureTourSeen, scheduleAt, scheduleModalOpen, schedulingSubmit,
  setActiveTab, setFeatureTourCurrent, setFeatureTourOpen, setScheduleAt, setScheduleModalOpen,
  setUpdateTourCurrent, submitProgress, updateTourCurrent, updateTourOpen, updateTourSteps,
}) {
  return (
    <>
      <Modal
        title={
          <Space>
            <ClockCircleOutlined style={{ color: "#1677ff" }} />
            <span>Schedule Automatic Submission</span>
          </Space>
        }
        open={scheduleModalOpen}
        onCancel={() => setScheduleModalOpen(false)}
        onOk={handleScheduleSubmission}
        okText="Schedule"
        okButtonProps={{ loading: schedulingSubmit, icon: <ClockCircleOutlined /> }}
        destroyOnHidden
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Choose when this submission should be sent automatically. Your encoded
          data is saved now and submitted at the scheduled time.
        </Text>
        <DatePicker
          showTime
          style={{ width: "100%" }}
          value={scheduleAt}
          onChange={setScheduleAt}
          disabledDate={(d) => d && d < dayjs().startOf("day")}
          placeholder="Select date & time"
        />
      </Modal>
      {/* Closing (X / mask / Esc) and finishing both mean the same thing to the
          user — "I'm done with this" — so both route through the ONE helper
          that records it server-side. It previously wrote only to localStorage,
          which logout wipes, so the tour came back on the next sign-in. */}
      <Tour
        open={updateTourOpen}
        current={updateTourCurrent}
        onChange={setUpdateTourCurrent}
        onClose={dismissTourPermanently}
        onFinish={dismissTourPermanently}
        steps={updateTourSteps}
      />

      {/* Feature tour — one time per RELEASE.
          CLOSING it (X, Esc, clicking away) closes it for now and does NOT
          record the release as seen: dismissing something in the middle of a
          task is not a decision never to see it. Two actions do record it —
          finishing the last step, and the "Don't show this again" button on
          every step — and What's New reopens it on demand either way. */}
      <Tour
        open={featureTourOpen}
        current={featureTourCurrent}
        // Steps span both Data Entry tabs, and the tabs render lazily — so when
        // the next step lives on the other one, switch first and let it mount
        // before antd measures the target. Advancing immediately would anchor
        // the step to nothing.
        onChange={(next) => {
          const tab = featureTourSteps[next]?.tab;
          if (tab && tab !== activeTab) {
            setActiveTab(tab);
            setTimeout(() => setFeatureTourCurrent(next), 160);
            return;
          }
          setFeatureTourCurrent(next);
        }}
        onClose={() => setFeatureTourOpen(false)}
        onFinish={markFeatureTourSeen}
        steps={featureTourSteps}
      />

      {/* Bulk submit progress — percentage feedback for large submissions */}
      <Modal
        open={submitProgress.open}
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={null}
        centered
        title={
          <Space>
            <SendOutlined style={{ color: "#1a3353" }} />
            <span>Submitting Disposal Data</span>
          </Space>
        }
      >
        <Progress
          percent={submitProgress.percent}
          status={
            submitProgress.error
              ? "exception"
              : submitProgress.percent >= 100
                ? "success"
                : "active"
          }
          strokeColor={submitProgress.error ? undefined : "#1a3353"}
        />
        <Text
          type={submitProgress.error ? "danger" : "secondary"}
          style={{ display: "block", marginTop: 10 }}
        >
          {submitProgress.text}
        </Text>
        {!submitProgress.error && (
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
            Please keep this window open until the submission completes.
          </Text>
        )}
      </Modal>
    </>
  );
}
