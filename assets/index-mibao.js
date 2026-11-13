(function(){
  async function initProductTabs(){
    await MB_waitElementReady(".collection_product_tabs .t4s-pr .t4s-flicky-slider [data-select-flickity]")
    await MB_sleep(500)
    const el = $(".collection_product_tabs .t4s-pr .t4s-flicky-slider")[0]
    const carousel = el.flickityt4s.$carousel
    const flkty = el.flickityt4s.flkty
    
    carousel.on("select.flickityt4s",onSelect)
    function onSelect(t, index) {
      // console.log(t, index, $(".collection_product_tabs .t4s-pr .t4s-flicky-slider"))
      $(".collection_product_tabs .t4s-pr .t4s-flicky-slider").addClass('ready_to_change_6_item')
      $(".collection_product_tabs .t4s-pr .t4s-flicky-slider .t4s-col-item").each(function(){
        const i = $(this).index()
        // console.log(index, i)
        $(this).removeClass(`is_mobile_show`)
        if(i>=index*6 && i < (index+1)*6){
          $(this).addClass(`is_mobile_show`)
        }
      })
    }
    window.addEventListener('resize',async()=>{
      carousel.off("select.flickityt4s",onSelect)
      // flkty.resize()
      // flkty.reposition()
      await MB_sleep(100)
      carousel.on("select.flickityt4s",onSelect)
      console.log('resize')
      await MB_sleep(100)
      $(".collection_product_tabs .t4s-pr .t4s-flicky-slider").removeClass('ready_to_change_6_item')
      $(".collection_product_tabs .t4s-pr .t4s-flicky-slider .t4s-col-item").removeClass('is_mobile_show')

    })
  }
  document.addEventListener('DOMContentLoaded', function(){
    console.log("DOMContentLoaded")
    MB_jsDeferHandle(initProductTabs, ['jQuery'])
  })
}())