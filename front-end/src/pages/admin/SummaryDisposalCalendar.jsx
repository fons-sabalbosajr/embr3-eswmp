// Heavy FullCalendar bundle (react wrapper + daygrid + interaction plugins) is
// split into its own lazy-loaded chunk so it is only downloaded when an admin
// opens a Summary "View" disposal calendar — not on the initial page load.
import { useEffect, useRef } from "react";
import dayjs from "dayjs";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

export default function SummaryDisposalCalendar({
  calendarDate,
  calendarEvents,
  onDateChange,
}) {
  const calendarRef = useRef(null);

  // `initialDate` is only read once when FullCalendar mounts, so when the
  // disposal data finishes loading (and `calendarDate` moves to the month that
  // actually has submissions) we must imperatively navigate the calendar there —
  // otherwise the events render in a month the admin never sees and the calendar
  // looks empty.
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (api && calendarDate) {
      api.gotoDate(calendarDate.toDate());
    }
  }, [calendarDate]);

  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[dayGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      initialDate={calendarDate.toDate()}
      events={calendarEvents}
      height={620}
      fixedWeekCount={false}
      dayMaxEvents={2}
      headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
      dateClick={(info) => onDateChange(dayjs(info.date))}
      eventClick={(info) => onDateChange(dayjs(info.event.start))}
      dayCellClassNames={(arg) =>
        dayjs(arg.date).isSame(calendarDate, "day") ? ["fc-selected-day"] : []
      }
      eventContent={(eventInfo) => {
        const item = eventInfo.event.extendedProps || {};
        return (
          <div style={{ lineHeight: 1.25, whiteSpace: "normal" }}>
            <div style={{ fontWeight: 700 }}>{eventInfo.event.title}</div>
            <div style={{ fontSize: 10, opacity: 0.9 }}>
              {item.count} submission{item.count !== 1 ? "s" : ""}
            </div>
          </div>
        );
      }}
    />
  );
}
