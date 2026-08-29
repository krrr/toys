<script setup lang="ts">
withDefaults(defineProps<{ hasImage?: boolean }>(), { hasImage: false })

defineEmits<{
  'pick-file': []
  'export': []
  'about': []
}>()
</script>

<template>
  <div class="navbar navbar-inverse navbar-static-top app-navbar">
    <div class="navbar-inner">
      <a class="brand" href="#" @click.prevent>
        <img src="/vhs.svg" class="app-icon"> VHS Filter
      </a>
      <ul class="nav">
        <li>
          <a href="#" @click.prevent="$emit('pick-file')">
            <i class="bi bi-upload"></i> Upload
          </a>
        </li>
        <li :class="{ disabled: !hasImage }">
          <a href="#" @click.prevent="hasImage && $emit('export')">
            <i class="bi bi-download"></i> Export
          </a>
        </li>
      </ul>
      <ul class="nav pull-right">
        <li>
          <a href="#" @click.prevent="$emit('about')">
            <i class="bi bi-info-circle"></i> About
          </a>
        </li>
      </ul>
    </div>
  </div>
</template>

<style lang="css" scoped>
.app-navbar {
    margin-bottom: 0;
    flex-shrink: 0;
}

.app-navbar .navbar-inner {
    border-radius: 0;
    padding-left: 10px;
    padding-right: 10px;
}

.app-navbar .brand {
    font-weight: bold;
    letter-spacing: 1px;
    padding: 0px 20px;
    line-height: 40px;
}

.app-navbar .nav > li > a {
    text-shadow: none;
}

.app-navbar .nav > li.disabled > a {
    color: #666;
    cursor: not-allowed;
}

.app-navbar .nav > li.disabled > a:hover {
    color: #666;
    text-decoration: none;
    background: none;
}
.app-icon {
  height: 22px;
  position: relative;
  top: -2px;
}
</style>
